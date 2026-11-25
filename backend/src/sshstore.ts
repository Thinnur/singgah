import type { DatabaseSync } from 'node:sqlite';
import { tx } from './leasestore.ts';
import { SHA512_CRYPT, SSH_USERNAME, sshUsernameFor } from './sshcred.ts';

export type SshStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';
type SshAction = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'REVOKED' | 'PASSWORD_SET';

/** uid inside the lab containers = SSH_UID_BASE + users.id, so a home dir keeps its owner across container rebuilds. */
export const SSH_UID_BASE = 10000;

/** A transition the current state does not allow; nothing was written. */
export class SshStateError extends Error {
  code: 'ALREADY_OPEN' | 'NOT_PENDING' | 'NOT_APPROVED' | 'LAB_UNAVAILABLE';
  constructor(code: SshStateError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

// Detail = who/which lab, never the password hash.
function audit(db: DatabaseSync, id: number, action: SshAction, actor: string, at: number, reason?: string | null): void {
  const i = db.prepare('SELECT a.lab_id, u.email, u.ssh_username FROM ssh_accounts a JOIN users u ON u.id=a.user_id WHERE a.id=?').get(id) as
    { lab_id: string; email: string; ssh_username: string };
  const detail = { email: i.email, username: i.ssh_username, labId: i.lab_id, ...(reason ? { reason } : {}) };
  db.prepare('INSERT INTO ssh_audit(account_id,action,actor,at,detail) VALUES(?,?,?,?,?)').run(id, action, actor, at, JSON.stringify(detail));
}

/** Gives the user an ssh_username on first use (kept forever, same in every lab) and opens a PENDING request. */
export function requestSsh(db: DatabaseSync, p: { userId: number; labId: string; actor: string; nowMs: number }): { id: number; username: string } {
  return tx(db, () => {
    const lab = db.prepare('SELECT is_active FROM labs WHERE id=?').get(p.labId) as { is_active: number } | undefined;
    if (lab?.is_active !== 1) throw new SshStateError('LAB_UNAVAILABLE', 'Lab sedang tidak tersedia');
    const u = db.prepare('SELECT email, ssh_username FROM users WHERE id=?').get(p.userId) as { email: string; ssh_username: string | null };
    let username = u.ssh_username;
    if (!username) {
      const taken = db.prepare('SELECT 1 FROM users WHERE ssh_username=?');
      username = sshUsernameFor(u.email, (n) => taken.get(n) !== undefined);
      db.prepare('UPDATE users SET ssh_username=? WHERE id=?').run(username, p.userId);
    }
    let id: number;
    try {
      ({ id } = db.prepare(`INSERT INTO ssh_accounts(user_id,lab_id,status,requested_at) VALUES(?,?,'PENDING',?) RETURNING id`)
        .get(p.userId, p.labId, p.nowMs) as { id: number });
    } catch (e) {
      if (String((e as Error).message).includes('UNIQUE constraint failed: ssh_accounts')) {
        throw new SshStateError('ALREADY_OPEN', 'Sudah ada pengajuan atau akun SSH di lab ini');
      }
      throw e;
    }
    audit(db, id, 'REQUESTED', p.actor, p.nowMs);
    return { id, username };
  });
}

export function decideSsh(db: DatabaseSync, p: { id: number; approve: boolean; by: string; reason: string | null; nowMs: number }): void {
  tx(db, () => {
    const status = p.approve ? 'APPROVED' : 'REJECTED';
    const { changes } = db.prepare("UPDATE ssh_accounts SET status=?, decided_at=?, decided_by=?, reason=? WHERE id=? AND status='PENDING'")
      .run(status, p.nowMs, p.by, p.reason, p.id);
    if (changes === 0) throw new SshStateError('NOT_PENDING', 'Pengajuan ini sudah diproses');
    audit(db, p.id, status, p.by, p.nowMs, p.reason);
  });
}

export function revokeSsh(db: DatabaseSync, p: { id: number; by: string; reason: string; nowMs: number }): void {
  tx(db, () => {
    const { changes } = db.prepare(
      "UPDATE ssh_accounts SET status='REVOKED', decided_at=?, decided_by=?, reason=?, password_hash=NULL WHERE id=? AND status='APPROVED'",
    ).run(p.nowMs, p.by, p.reason, p.id);
    if (changes === 0) throw new SshStateError('NOT_APPROVED', 'Akun SSH belum disetujui atau sudah dicabut');
    audit(db, p.id, 'REVOKED', p.by, p.nowMs, p.reason);
  });
}

/** Caller checks ownership. Replaces any previous hash, so the old password stops working. */
export function setSshPasswordHash(db: DatabaseSync, p: { id: number; hash: string; actor: string; nowMs: number }): void {
  tx(db, () => {
    const { changes } = db.prepare("UPDATE ssh_accounts SET password_hash=?, password_set_at=? WHERE id=? AND status='APPROVED'")
      .run(p.hash, p.nowMs, p.id);
    if (changes === 0) throw new SshStateError('NOT_APPROVED', 'Akun SSH belum disetujui atau sudah dicabut');
    audit(db, p.id, 'PASSWORD_SET', p.actor, p.nowMs);
  });
}

/** Content of the lab container's accounts file: "username:uid:hash" per APPROVED account (empty hash = locked). */
export function labAccountsFile(db: DatabaseSync, labId: string): string {
  const rows = db.prepare(
    `SELECT u.ssh_username, u.id, a.password_hash FROM ssh_accounts a JOIN users u ON u.id=a.user_id
     WHERE a.lab_id=? AND a.status='APPROVED' ORDER BY u.ssh_username`,
  ).all(labId) as { ssh_username: string | null; id: number; password_hash: string | null }[];
  // the API runs without root; a tampered row must not become a strange account in the container
  return rows
    .filter((r) => SSH_USERNAME.test(r.ssh_username ?? '') && (r.password_hash === null || SHA512_CRYPT.test(r.password_hash)))
    .map((r) => `${r.ssh_username}:${SSH_UID_BASE + r.id}:${r.password_hash ?? ''}\n`)
    .join('');
}
