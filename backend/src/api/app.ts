import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import type { DatabaseSync } from 'node:sqlite';
import type { Config } from '../config.ts';
import type { ApiError } from './types.ts';
import { HttpError } from './session.ts';
import { authRoutes } from './auth.ts';

// staticDir is accepted now; static serving is added in a later task.
export function buildApp(o: { db: DatabaseSync; config: Config; fetchFn?: typeof fetch; now?: () => number; staticDir?: string }): FastifyInstance {
  const app = Fastify({ logger: false, trustProxy: false });
  app.register(cookie);
  app.decorate('ctx', { db: o.db, config: o.config, fetchFn: o.fetchFn ?? fetch, now: o.now ?? Date.now });

  app.addHook('onRequest', async (req) => {
    const p = req.url.split('?')[0];
    if ((req.method === 'POST' || req.method === 'PATCH') && (p.startsWith('/api/') || p === '/auth/logout') &&
        !String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type harus application/json');
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const e = err instanceof HttpError
      ? { status: err.status, body: { code: err.code, message: err.message } }
      : err.statusCode && err.statusCode < 500
        ? { status: err.statusCode, body: { code: 'BAD_REQUEST', message: 'Permintaan tidak valid' } }
        : { status: 500, body: { code: 'INTERNAL', message: 'Terjadi kesalahan pada server' } };
    if (e.status === 500) console.error(err);
    return reply.status(e.status).send(e.body satisfies ApiError);
  });

  authRoutes(app);
  return app;
}
