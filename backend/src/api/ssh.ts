import type { FastifyInstance } from 'fastify';
import { parseCidr } from '../rules.ts';
import { generatePassword, hashPassword } from '../sshcred.ts';
import { SshStateError, decideSsh, requestSsh, revokeSsh, setSshPasswordHash, type SshStatus } from '../sshstore.ts';
import type { AdminSshAccount, SshAuditEntry, SshLabView, SshPasswordResponse } from './types.ts';
import { HttpError, requireAdmin, requireUser } from './session.ts';

const STATUSES: SshStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'REVOKED'];
const PASSWORD_GAP_MS = 10_000;
const bad = (m: string) => new HttpError(400, 'BAD_REQUEST', m);
const nonBlank = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** The lab's container ("VM target") is .10 of its subnet. */
function labTargetIp(cidr: string): string {
  const n = parseCidr(cidr).net + 10;
  return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
}

const HTTP: Record<SshStateError['code'], [number, string, string]> = {
  ALREADY_OPEN: [409, 'ALREADY_REQUESTED', 'Kamu sudah punya pengajuan atau akun SSH di lab ini'],
  LAB_UNAVAILABLE: [404, 'LAB_UNAVAILABLE', 'Lab sedang tidak tersedia'],
  NOT_PENDING: [409, 'NOT_PENDING', 'Pengajuan ini sudah diproses'],
  NOT_APPROVED: [409, 'NOT_APPROVED', 'Akun SSH belum disetujui atau sudah dicabut'],
};
function mapped<T>(fn: () => T): T {
  try { return fn(); } catch (e) {
    if (e instanceof SshStateError) throw new HttpError(...HTTP[e.code]);
    throw e;
  }
}

type AccountRow = {
  id: number; email: string; ssh_username: string; lab_id: string; lab_name: string; status: SshStatus;
  requested_at: number; decided_at: number | null; decided_by: string | null; reason: string | null; pw: number;
};
const ACCOUNT_SELECT = `SELECT a.id, u.email, u.ssh_username, a.lab_id, b.name AS lab_name, a.status, a.requested_at, a.decided_at,
  a.decided_by, a.reason, a.password_hash IS NOT NULL AS pw FROM ssh_accounts a JOIN users u ON u.id=a.user_id JOIN labs b ON b.id=a.lab_id`;

export function sshRoutes(app: FastifyInstance): void {
  const { ctx } = app;
  const { db } = ctx;

  function labView(userId: number, lab: { id: string; name: string; target_cidr: string }): SshLabView {
    const a = db.prepare(`${ACCOUNT_SELECT} WHERE a.user_id=? AND a.lab_id=? ORDER BY a.id DESC LIMIT 1`).get(userId, lab.id) as AccountRow | undefined;
    return {
      labId: lab.id, labName: lab.name, host: labTargetIp(lab.target_cidr),
      account: a ? { id: a.id, status: a.status, username: a.ssh_username, reason: a.reason, requestedAt: a.requested_at,
        decidedAt: a.decided_at, passwordSet: a.pw === 1 } : null,
    };
  }
  const getLab = (id: string) => db.prepare('SELECT id, name, target_cidr FROM labs WHERE id=?').get(id) as
    { id: string; name: string; target_cidr: string } | undefined;

  app.get('/api/ssh', async (req): Promise<SshLabView[]> => {
    const u = requireUser(req);
    const labs = db.prepare('SELECT id, name, target_cidr FROM labs WHERE is_active=1 ORDER BY id').all() as { id: string; name: string; target_cidr: string }[];
    return labs.map((l) => labView(u.id, l));
  });

  app.post<{ Body: { labId?: unknown } }>('/api/ssh', async (req, reply) => {
    const u = requireUser(req);
    const labId = req.body?.labId;
    if (typeof labId !== 'string') throw bad('labId (teks) wajib diisi');
    mapped(() => requestSsh(db, { userId: u.id, labId, actor: u.email, nowMs: ctx.now() }));
    return reply.status(201).send(labView(u.id, getLab(labId)!));
  });

  app.post<{ Params: { id: string } }>('/api/ssh/:id/password', async (req): Promise<SshPasswordResponse> => {
    const u = requireUser(req);
    const a = db.prepare(
      `SELECT a.id, a.status, a.password_set_at, u.ssh_username, b.target_cidr FROM ssh_accounts a
       JOIN users u ON u.id=a.user_id JOIN labs b ON b.id=a.lab_id WHERE a.id=? AND a.user_id=?`,
    ).get(Number(req.params.id), u.id) as { id: number; status: SshStatus; password_set_at: number | null; ssh_username: string; target_cidr: string } | undefined;
    if (!a) throw new HttpError(404, 'NOT_FOUND', 'Akun SSH tidak ditemukan');
    if (a.status !== 'APPROVED') throw new HttpError(...HTTP.NOT_APPROVED);
    if (a.password_set_at !== null && ctx.now() - a.password_set_at < PASSWORD_GAP_MS) {
      throw new HttpError(429, 'TOO_SOON', 'Tunggu sebentar sebelum membuat password lagi');
    }
    const password = generatePassword();
    const hash = await hashPassword(password);
    // re-checks APPROVED: an admin may have revoked while openssl ran
    mapped(() => setSshPasswordHash(db, { id: a.id, hash, actor: u.email, nowMs: ctx.now() }));
    return { username: a.ssh_username, host: labTargetIp(a.target_cidr), password };
  });

  app.get<{ Querystring: { status?: string } }>('/api/admin/ssh', async (req): Promise<AdminSshAccount[]> => {
    requireAdmin(req);
    const status = (req.query.status ?? 'PENDING') as SshStatus;
    if (!STATUSES.includes(status)) throw bad('status harus PENDING, APPROVED, REJECTED, atau REVOKED');
    const order = status === 'PENDING' ? 'ORDER BY a.requested_at, a.id' : 'ORDER BY COALESCE(a.decided_at, a.requested_at) DESC, a.id DESC LIMIT 500';
    return (db.prepare(`${ACCOUNT_SELECT} WHERE a.status=? ${order}`).all(status) as AccountRow[]).map((r) => ({
      id: r.id, email: r.email, username: r.ssh_username, labId: r.lab_id, labName: r.lab_name, status: r.status,
      requestedAt: r.requested_at, decidedAt: r.decided_at, decidedBy: r.decided_by, reason: r.reason, passwordSet: r.pw === 1,
    }));
  });

  const exists = (id: number) => {
    if (!db.prepare('SELECT 1 FROM ssh_accounts WHERE id=?').get(id)) throw new HttpError(404, 'NOT_FOUND', 'Akun SSH tidak ditemukan');
  };

  app.post<{ Params: { id: string } }>('/api/admin/ssh/:id/approve', async (req) => {
    const admin = requireAdmin(req);
    const id = Number(req.params.id);
    exists(id);
    mapped(() => decideSsh(db, { id, approve: true, by: admin.email, reason: null, nowMs: ctx.now() }));
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { reason?: unknown } }>('/api/admin/ssh/:id/reject', async (req) => {
    const admin = requireAdmin(req);
    const reason = req.body?.reason;
    if (!nonBlank(reason)) throw bad('Alasan wajib diisi');
    const id = Number(req.params.id);
    exists(id);
    mapped(() => decideSsh(db, { id, approve: false, by: admin.email, reason: reason.trim(), nowMs: ctx.now() }));
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { reason?: unknown } }>('/api/admin/ssh/:id/revoke', async (req) => {
    const admin = requireAdmin(req);
    const reason = req.body?.reason;
    if (!nonBlank(reason)) throw bad('Alasan wajib diisi');
    const id = Number(req.params.id);
    exists(id);
    mapped(() => revokeSsh(db, { id, by: admin.email, reason: reason.trim(), nowMs: ctx.now() }));
    return { ok: true };
  });

  app.get('/api/admin/ssh/audit', async (req): Promise<SshAuditEntry[]> => {
    requireAdmin(req);
    const rows = db.prepare('SELECT id, account_id, action, actor, at, detail FROM ssh_audit ORDER BY at DESC, id DESC LIMIT 500').all() as
      { id: number; account_id: number; action: SshAuditEntry['action']; actor: string; at: number; detail: string }[];
    return rows.map((r) => ({ id: r.id, accountId: r.account_id, action: r.action, actor: r.actor, at: r.at, detail: JSON.parse(r.detail) }));
  });
}
