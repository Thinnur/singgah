import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.ts';

export const SESSION_MS = 12 * 3600_000;
export type Ctx = { db: DatabaseSync; config: Config; fetchFn: typeof fetch; now: () => number; sysNetDir: string };
export type SessionUser = { id: number; email: string; name: string; role: 'student' | 'admin' };

declare module 'fastify' {
  interface FastifyInstance { ctx: Ctx }
}

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function requireUser(req: FastifyRequest): SessionUser {
  const { db, now } = req.server.ctx;
  const sid = req.cookies.singgah_sid;
  const row = sid
    ? (db.prepare('SELECT u.id, u.email, u.name, u.role, s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?').get(sid) as
        | (SessionUser & { expires_at: number }) | undefined)
    : undefined;
  if (!row || row.expires_at <= now()) {
    if (row) db.prepare('DELETE FROM sessions WHERE id=?').run(sid!);
    throw new HttpError(401, 'UNAUTHENTICATED', 'Silakan masuk terlebih dahulu');
  }
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export function requireAdmin(req: FastifyRequest): SessionUser {
  const u = requireUser(req);
  if (u.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', 'Hanya untuk admin');
  return u;
}

export function clientIp(req: FastifyRequest, trustedProxyIp: string): string {
  const cf = req.headers['cf-connecting-ip'];
  return req.socket.remoteAddress === trustedProxyIp && typeof cf === 'string' ? cf : req.ip;
}

export function cookieOpts(config: Config, maxAgeMs: number) {
  return { httpOnly: true, sameSite: 'lax' as const, path: '/', secure: config.publicUrl.startsWith('https:'), maxAge: maxAgeMs / 1000 };
}

/** Upsert user by normalized email (role from adminEmails), create session cookie. */
export function startSession(ctx: Ctx, reply: FastifyReply, email: string, name: string): void {
  const { db, config, now } = ctx;
  const t = now();
  const role = config.adminEmails.includes(email) ? 'admin' : 'student';
  const user = db.prepare(
    `INSERT INTO users(email,name,role,created_at,last_login_at) VALUES(?,?,?,?,?)
     ON CONFLICT(email) DO UPDATE SET name=excluded.name, role=excluded.role, last_login_at=excluded.last_login_at
     RETURNING id`,
  ).get(email, name, role, t, t) as { id: number };
  db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(t);
  const sid = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,?)').run(sid, user.id, t + SESSION_MS);
  reply.setCookie('singgah_sid', sid, cookieOpts(config, SESSION_MS));
}
