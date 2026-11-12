import type { DatabaseSync } from 'node:sqlite';
import { allocateIp } from './rules.ts';

/** Thrown by createLease when no tunnel IP is free; routes map it to POOL_FULL. */
export class PoolFullError extends Error {
  constructor() { super('pool penuh'); }
}

function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/** Callers do the policy checks. UNIQUE violations (user_id / tunnel_ip) propagate as-is. */
export function createLease(db: DatabaseSync, p: {
  userId: number; labId: string; minutes: number; clientPubkey: string;
  requesterIp: string | null; actor: string; nowMs: number;
}): { id: number; tunnelIp: string; startsAt: number; expiresAt: number } {
  return tx(db, () => {
    const taken = new Set((db.prepare('SELECT tunnel_ip FROM leases WHERE ended_at IS NULL').all() as { tunnel_ip: string }[]).map((r) => r.tunnel_ip));
    const tunnelIp = allocateIp(taken);
    if (!tunnelIp) throw new PoolFullError();
    const startsAt = p.nowMs;
    const expiresAt = startsAt + p.minutes * 60_000;
    const { id } = db.prepare(
      `INSERT INTO leases(user_id,lab_id,tunnel_ip,client_pubkey,status,starts_at,expires_at,requester_ip)
       VALUES(?,?,?,?,'ACTIVE',?,?,?) RETURNING id`,
    ).get(p.userId, p.labId, tunnelIp, p.clientPubkey, startsAt, expiresAt, p.requesterIp) as { id: number };
    const { email } = db.prepare('SELECT email FROM users WHERE id=?').get(p.userId) as { email: string };
    db.prepare('INSERT INTO audit_log(lease_id,action,actor,at,detail) VALUES(?,?,?,?,?)').run(
      id, 'ISSUED', p.actor, p.nowMs,
      JSON.stringify({ email, tunnelIp, labId: p.labId, minutes: p.minutes, requesterIp: p.requesterIp }),
    );
    return { id, tunnelIp, startsAt, expiresAt };
  });
}

/** Caller checks ownership and that the lease is ACTIVE. */
export function revokeLease(db: DatabaseSync, p: { leaseId: number; by: string; reason: string; nowMs: number }): void {
  tx(db, () => {
    db.prepare("UPDATE leases SET status='REVOKED', revoked_at=?, revoked_by=?, reason=? WHERE id=?").run(p.nowMs, p.by, p.reason, p.leaseId);
    const l = db.prepare('SELECT l.lab_id, l.tunnel_ip, u.email FROM leases l JOIN users u ON u.id=l.user_id WHERE l.id=?').get(p.leaseId) as
      { lab_id: string; tunnel_ip: string; email: string };
    db.prepare('INSERT INTO audit_log(lease_id,action,actor,at,detail) VALUES(?,?,?,?,?)').run(
      p.leaseId, 'REVOKED', p.by, p.nowMs,
      JSON.stringify({ email: l.email, tunnelIp: l.tunnel_ip, labId: l.lab_id, reason: p.reason }),
    );
  });
}
