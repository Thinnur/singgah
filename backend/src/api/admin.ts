import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { RESERVED_CIDRS, cidrOverlaps, parseCidr } from '../rules.ts';
import { LeaseNotActiveError, revokeLease } from '../leasestore.ts';
import type { AdminLab, AdminLease, AuditEntry, Stats } from './types.ts';
import { HttpError, requireAdmin } from './session.ts';
import { LEASE_COLS, leaseView, type LeaseRow } from './leases.ts';

type LabRow = { id: string; name: string; target_cidr: string; max_hours: number; is_active: number; created_at: number };
const labView = (r: LabRow): AdminLab => ({ id: r.id, name: r.name, targetCidr: r.target_cidr, maxHours: r.max_hours, isActive: r.is_active === 1, createdAt: r.created_at });
const bad = (m: string) => new HttpError(400, 'BAD_REQUEST', m);
const validHours = (v: unknown): v is number => v === 1 || v === 2 || v === 4;
const nonBlank = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

export function adminRoutes(app: FastifyInstance): void {
  const { ctx } = app;
  const { db } = ctx;
  const getLab = (id: string) => db.prepare('SELECT * FROM labs WHERE id=?').get(id) as LabRow | undefined;

  app.get<{ Querystring: { status?: string } }>('/api/admin/leases', async (req): Promise<AdminLease[]> => {
    requireAdmin(req);
    const status = req.query.status ?? 'ACTIVE';
    if (!['ACTIVE', 'EXPIRED', 'REVOKED'].includes(status)) throw bad('status harus ACTIVE, EXPIRED, atau REVOKED');
    const rows = db.prepare(
      `SELECT ${LEASE_COLS}, u.email, l.requester_ip FROM leases l JOIN labs b ON b.id=l.lab_id JOIN users u ON u.id=l.user_id
       WHERE l.status=? ORDER BY l.expires_at`,
    ).all(status) as (LeaseRow & { email: string; requester_ip: string | null })[];
    return rows.map((r) => ({ ...leaseView(r), email: r.email, requesterIp: r.requester_ip }));
  });

  app.post<{ Params: { id: string }; Body: { reason?: unknown } }>('/api/admin/leases/:id/revoke', async (req) => {
    const admin = requireAdmin(req);
    const reason = req.body?.reason;
    if (!nonBlank(reason)) throw bad('Alasan wajib diisi');
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM leases WHERE id=?').get(id)) throw new HttpError(404, 'NOT_FOUND', 'Lease tidak ditemukan');
    try { revokeLease(db, { leaseId: id, by: admin.email, reason: reason.trim(), nowMs: ctx.now() }); }
    catch (e) { throw e instanceof LeaseNotActiveError ? new HttpError(409, 'NOT_ACTIVE', 'Lease sudah tidak aktif') : e; }
    return { ok: true };
  });

  app.get('/api/admin/labs', async (req): Promise<AdminLab[]> => {
    requireAdmin(req);
    return (db.prepare('SELECT * FROM labs ORDER BY id').all() as LabRow[]).map(labView);
  });

  app.post<{ Body: { id?: unknown; name?: unknown; targetCidr?: unknown; maxHours?: unknown } }>('/api/admin/labs', async (req, reply) => {
    requireAdmin(req);
    const { id, name, targetCidr, maxHours } = req.body ?? {};
    if (typeof id !== 'string' || !/^lab-[a-z0-9]{1,20}$/.test(id)) throw bad('id lab harus berformat lab-<huruf kecil/angka>, maksimal 20 karakter setelah "lab-"');
    if (getLab(id)) throw new HttpError(409, 'CONFLICT', 'id lab sudah dipakai');
    if (!nonBlank(name)) throw bad('Nama lab wajib diisi');
    if (!validHours(maxHours)) throw bad('maxHours harus 1, 2, atau 4');
    if (typeof targetCidr !== 'string') throw bad('targetCidr wajib diisi');
    try { parseCidr(targetCidr); } catch { throw bad('targetCidr bukan CIDR yang valid (contoh 192.168.40.0/24)'); }
    if (RESERVED_CIDRS.some((c) => cidrOverlaps(targetCidr, c))) throw bad('targetCidr bentrok dengan jaringan yang dicadangkan');
    const labs = db.prepare('SELECT target_cidr FROM labs').all() as { target_cidr: string }[];
    if (labs.some((l) => cidrOverlaps(targetCidr, l.target_cidr))) throw bad('targetCidr bentrok dengan lab lain');
    db.prepare('INSERT INTO labs(id,name,target_cidr,max_hours,is_active,created_at) VALUES(?,?,?,?,1,?)').run(id, name.trim(), targetCidr, maxHours, ctx.now());
    return reply.status(201).send(labView(getLab(id)!));
  });

  app.patch<{ Params: { id: string }; Body: { name?: unknown; maxHours?: unknown; isActive?: unknown } }>('/api/admin/labs/:id', async (req) => {
    requireAdmin(req);
    const lab = getLab(req.params.id);
    if (!lab) throw new HttpError(404, 'NOT_FOUND', 'Lab tidak ditemukan');
    const b = (req.body ?? {}) as Record<string, unknown>;
    if ('targetCidr' in b) throw bad('targetCidr tidak bisa diubah');
    if (b.name !== undefined && !nonBlank(b.name)) throw bad('Nama lab wajib diisi');
    if (b.maxHours !== undefined && !validHours(b.maxHours)) throw bad('maxHours harus 1, 2, atau 4');
    if (b.isActive !== undefined && typeof b.isActive !== 'boolean') throw bad('isActive harus true atau false');
    db.prepare('UPDATE labs SET name=?, max_hours=?, is_active=? WHERE id=?').run(
      b.name === undefined ? lab.name : (b.name as string).trim(),
      b.maxHours === undefined ? lab.max_hours : (b.maxHours as number),
      b.isActive === undefined ? lab.is_active : (b.isActive ? 1 : 0),
      lab.id,
    );
    return labView(getLab(lab.id)!);
  });

  app.get<{ Querystring: { ip?: string; email?: string; from?: string; to?: string } }>('/api/admin/audit', async (req): Promise<AuditEntry[]> => {
    requireAdmin(req);
    const { ip, email, from, to } = req.query;
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (ip) { where.push("json_extract(detail,'$.tunnelIp')=?"); args.push(ip); }
    if (email) { where.push("json_extract(detail,'$.email')=?"); args.push(email.trim().toLowerCase()); }
    for (const [v, op] of [[from, '>='], [to, '<=']] as const) {
      if (v === undefined || v === '') continue;
      const n = Number(v);
      if (!Number.isFinite(n)) throw bad('from/to harus berupa epoch milidetik');
      where.push(`at ${op} ?`); args.push(n);
    }
    const rows = db.prepare(
      `SELECT id,lease_id,action,actor,at,detail FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY at DESC, id DESC LIMIT 500`,
    ).all(...args) as { id: number; lease_id: number | null; action: AuditEntry['action']; actor: string; at: number; detail: string }[];
    return rows.map((r) => ({ id: r.id, leaseId: r.lease_id, action: r.action, actor: r.actor, at: r.at, detail: JSON.parse(r.detail) }));
  });

  let prev: { at: number; rx: number; tx: number } | null = null;
  const readCounter = (name: string) => Number(readFileSync(join(ctx.sysNetDir, ctx.config.wgInterface, 'statistics', name), 'utf8').trim());
  function wg0Rates(): Stats['wg0'] {
    let cur: { at: number; rx: number; tx: number };
    try { cur = { at: ctx.now(), rx: readCounter('rx_bytes'), tx: readCounter('tx_bytes') }; } catch { prev = null; return null; }
    if (!Number.isFinite(cur.rx) || !Number.isFinite(cur.tx)) { prev = null; return null; }
    const p = prev;
    prev = cur;
    if (!p || cur.at <= p.at) return null;
    const s = (cur.at - p.at) / 1000;
    // counter reset (interface restart) clamps to 0
    return { rxBps: Math.max(0, cur.rx - p.rx) / s, txBps: Math.max(0, cur.tx - p.tx) / s };
  }

  app.get('/api/admin/stats', async (req): Promise<Stats> => {
    requireAdmin(req);
    const perLab = db.prepare(
      `SELECT b.id AS labId, b.name AS labName, count(l.id) AS leases,
         COALESCE(sum((l.expires_at - l.starts_at)/60000),0) AS minutes
       FROM labs b LEFT JOIN leases l ON l.lab_id=b.id AND l.status='ACTIVE' GROUP BY b.id ORDER BY b.id`,
    ).all() as Stats['perLab'];
    return { activeLeases: perLab.reduce((a, l) => a + l.leases, 0), perLab, wg0: wg0Rates() };
  });
}
