import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { isEmailAllowed, nextWibMidnight, normalizeEmail, usedMinutesToday } from '../rules.ts';
import type { Me } from './types.ts';
import { HttpError, cookieOpts, requireUser, startSession } from './session.ts';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

export function authRoutes(app: FastifyInstance): void {
  const { ctx } = app;
  const { config, db } = ctx;

  app.get('/auth/login', async (_req, reply) => {
    const state = randomBytes(16).toString('hex');
    reply.setCookie('singgah_state', state, cookieOpts(config, 10 * 60_000));
    const q = new URLSearchParams({
      client_id: config.googleClientId,
      redirect_uri: `${config.publicUrl}/auth/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
    });
    return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
  });

  app.get<{ Querystring: { code?: string; state?: string } }>('/auth/callback', async (req, reply) => {
    const fail = (code: string) => reply.clearCookie('singgah_state', { path: '/' }).redirect(`/login?error=${code}`);
    const { code, state } = req.query;
    const saved = req.cookies.singgah_state;
    if (!code || !state || !saved || state !== saved) return fail('STATE');
    let claims: Record<string, unknown>;
    try {
      const res = await ctx.fetchFn('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code, client_id: config.googleClientId, client_secret: config.googleClientSecret,
          redirect_uri: `${config.publicUrl}/auth/callback`, grant_type: 'authorization_code',
        }),
      });
      if (!res.ok) return fail('TOKEN');
      const { id_token } = (await res.json()) as { id_token?: string };
      // Token comes straight from Google over TLS, so no signature check (see design §5.5).
      claims = JSON.parse(Buffer.from(String(id_token).split('.')[1] ?? '', 'base64url').toString());
    } catch {
      return fail('TOKEN');
    }
    if (!ISSUERS.has(claims.iss as string) || claims.aud !== config.googleClientId ||
        typeof claims.exp !== 'number' || claims.exp * 1000 <= ctx.now() ||
        claims.email_verified !== true || typeof claims.email !== 'string') return fail('TOKEN');
    const email = normalizeEmail(claims.email);
    if (!isEmailAllowed(email, config.extraAllowedEmails)) return fail('EMAIL_NOT_ALLOWED');
    startSession(ctx, reply, email, typeof claims.name === 'string' && claims.name ? claims.name : email.split('@')[0]);
    return reply.clearCookie('singgah_state', { path: '/' }).redirect('/');
  });

  app.post('/auth/logout', async (req, reply) => {
    const sid = req.cookies.singgah_sid;
    if (sid) db.prepare('DELETE FROM sessions WHERE id=?').run(sid);
    return reply.clearCookie('singgah_sid', { path: '/' }).send({ ok: true });
  });

  app.post<{ Body: { email?: unknown } }>('/auth/test-login', async (req, reply) => {
    if (!config.testMode) throw new HttpError(404, 'NOT_FOUND', 'Tidak ditemukan');
    // di belakang nginx semua koneksi datang dari 127.0.0.1; header Cloudflare menandai permintaan dari internet
    if (!LOOPBACK.has(req.socket.remoteAddress ?? '') || req.headers['cf-connecting-ip'] !== undefined) {
      throw new HttpError(403, 'FORBIDDEN', 'Hanya dari localhost');
    }
    const email = normalizeEmail(String(req.body?.email ?? ''));
    if (!isEmailAllowed(email, config.extraAllowedEmails)) {
      throw new HttpError(403, 'EMAIL_NOT_ALLOWED', 'Email ini tidak diizinkan. Gunakan akun UGM (@mail.ugm.ac.id atau @ugm.ac.id)');
    }
    startSession(ctx, reply, email, email.split('@')[0]);
    return { ok: true };
  });

  app.get('/api/me', async (req): Promise<Me> => {
    const u = requireUser(req);
    const now = ctx.now();
    const leases = db.prepare('SELECT starts_at, expires_at, revoked_at FROM leases WHERE user_id=?').all(u.id) as
      { starts_at: number; expires_at: number; revoked_at: number | null }[];
    return {
      email: u.email, name: u.name, role: u.role,
      quotaMinutesLeft: Math.max(0, config.dailyQuotaHours * 60 - usedMinutesToday(leases, now)),
      quotaResetsAt: nextWibMidnight(now),
    };
  });
}
