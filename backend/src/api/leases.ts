import type { FastifyInstance } from 'fastify';
import { HAS_ACTIVE, POOL_FULL, allowedDurations, checkLeaseRequest, usedMinutesToday, type Rejection } from '../rules.ts';
import { clientConfig, generateKeyPair } from '../wgkeys.ts';
import { LeaseNotActiveError, PoolFullError, createLease, revokeLease } from '../leasestore.ts';
import type { IssueResponse, LabOption, LeaseView } from './types.ts';
import { HttpError, clientIp, requireUser } from './session.ts';

export type LeaseRow = {
  id: number; lab_id: string; lab_name: string; tunnel_ip: string; status: LeaseView['status'];
  starts_at: number; expires_at: number; revoked_at: number | null; reason: string | null;
  installed_at: number | null; bytes_rx: number | null; bytes_tx: number | null;
};
export const LEASE_COLS = `l.id,l.lab_id,b.name AS lab_name,l.tunnel_ip,l.status,l.starts_at,l.expires_at,l.revoked_at,l.reason,
  l.installed_at,l.bytes_rx,l.bytes_tx`;
const SELECT = `SELECT ${LEASE_COLS} FROM leases l JOIN labs b ON b.id=l.lab_id`;

export const leaseView = (r: LeaseRow): LeaseView => ({
  id: r.id, labId: r.lab_id, labName: r.lab_name, tunnelIp: r.tunnel_ip, status: r.status,
  startsAt: r.starts_at, expiresAt: r.expires_at, revokedAt: r.revoked_at, reason: r.reason,
  peerActive: r.installed_at != null, bytesRx: r.bytes_rx ?? 0, bytesTx: r.bytes_tx ?? 0,
});
const reject = (r: Rejection) => new HttpError(r.status, r.code, r.message);
const uniqueOn = (e: unknown, col: string) => String((e as Error)?.message).includes(`UNIQUE constraint failed: leases.${col}`);

export function leaseRoutes(app: FastifyInstance): void {
  const { ctx } = app;
  const { db, config } = ctx;

  app.get('/api/labs', async (req): Promise<LabOption[]> => {
    requireUser(req);
    const labs = db.prepare('SELECT id,name,max_hours FROM labs WHERE is_active=1 ORDER BY id').all() as { id: string; name: string; max_hours: number }[];
    return labs.map((l) => ({ id: l.id, name: l.name, maxHours: l.max_hours, durations: allowedDurations(l.max_hours, config.testMode) }));
  });

  app.get('/api/leases/current', async (req): Promise<LeaseView | null> => {
    const u = requireUser(req);
    const r = db.prepare(`${SELECT} WHERE l.user_id=? AND l.status='ACTIVE'`).get(u.id) as LeaseRow | undefined;
    return r ? leaseView(r) : null;
  });

  app.post<{ Body: { labId?: unknown; minutes?: unknown } }>('/api/leases', async (req, reply) => {
    const u = requireUser(req);
    const { labId, minutes } = req.body ?? {};
    if (typeof labId !== 'string' || typeof minutes !== 'number' || !Number.isInteger(minutes)) {
      throw new HttpError(400, 'BAD_REQUEST', 'labId (teks) dan minutes (angka bulat) wajib diisi');
    }
    const now = ctx.now();
    const lab = db.prepare('SELECT id,name,target_cidr,max_hours,is_active FROM labs WHERE id=?').get(labId) as
      { id: string; name: string; target_cidr: string; max_hours: number; is_active: number } | undefined;
    const mine = db.prepare('SELECT starts_at,expires_at,revoked_at,status,ended_at FROM leases WHERE user_id=?').all(u.id) as
      { starts_at: number; expires_at: number; revoked_at: number | null; status: string; ended_at: number | null }[];
    const rej = checkLeaseRequest({
      lab, minutes, hasActive: mine.some((l) => l.status === 'ACTIVE'), usedMinutes: usedMinutesToday(mine, now),
      quotaHours: config.dailyQuotaHours, testMode: config.testMode, nowMs: now,
    });
    if (rej) throw reject(rej);
    // a released/expired lease keeps its tunnel IP until the worker closes it; rapid cycling would drain the pool
    if (mine.some((l) => l.ended_at === null)) throw new HttpError(409, 'PREV_CLOSING', 'Lease sebelumnya masih ditutup, coba lagi beberapa detik lagi');

    const kp = generateKeyPair();
    const p = { userId: u.id, labId, minutes, clientPubkey: kp.publicKey, requesterIp: clientIp(req, config.trustedProxyIp), actor: u.email, nowMs: now };
    let made: ReturnType<typeof createLease>;
    try {
      try { made = createLease(db, p); }
      catch (e) { if (!uniqueOn(e, 'tunnel_ip')) throw e; made = createLease(db, p); } // one retry on IP race
    } catch (e) {
      if (uniqueOn(e, 'user_id')) throw reject(HAS_ACTIVE);
      if (e instanceof PoolFullError || uniqueOn(e, 'tunnel_ip')) throw reject(POOL_FULL);
      throw e;
    }
    const row = db.prepare(`${SELECT} WHERE l.id=?`).get(made.id) as LeaseRow;
    const config_ = clientConfig({ privateKey: kp.privateKey, address: made.tunnelIp, serverPubkey: config.wgServerPubkey, endpoint: config.wgEndpoint, labCidr: lab!.target_cidr });
    // nama file = nama interface di wg-quick dan WireGuard Android: maksimal 15 karakter
    return reply.status(201).send({ lease: leaseView(row), config: config_, filename: `${`singgah-${labId.replace(/^lab-/, '')}`.slice(0, 15)}.conf` } satisfies IssueResponse);
  });

  app.post<{ Params: { id: string } }>('/api/leases/:id/release', async (req) => {
    const u = requireUser(req);
    const row = db.prepare('SELECT id,status FROM leases WHERE id=? AND user_id=?').get(Number(req.params.id), u.id) as { id: number; status: string } | undefined;
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Lease tidak ditemukan');
    if (row.status !== 'ACTIVE') throw new HttpError(409, 'NOT_ACTIVE', 'Lease sudah tidak aktif');
    try { revokeLease(db, { leaseId: row.id, by: u.email, reason: 'Dilepas pemohon', nowMs: ctx.now() }); }
    catch (e) { throw e instanceof LeaseNotActiveError ? new HttpError(409, 'NOT_ACTIVE', 'Lease sudah tidak aktif') : e; }
    return { ok: true };
  });
}
