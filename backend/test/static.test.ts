import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.ts';
import { loadConfig } from '../src/config.ts';
import { buildApp } from '../src/api/app.ts';

test('staticDir: SPA fallback for page paths, JSON 404 for unknown /api and /auth', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'singgah-'));
  const dist = join(dir, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Singgah</title>');
  writeFileSync(join(dist, 'assets', 'app.js'), 'console.log(1)');
  const db = openDb(join(dir, 't.db'));
  const app = buildApp({ db, config: loadConfig({ TEST_MODE: '1' }), staticDir: dist });
  try {
    for (const url of ['/admin/labs', '/', '/hasil', '/login?error=STATE']) {
      const r = await app.inject({ method: 'GET', url });
      assert.equal(r.statusCode, 200, url);
      assert.match(String(r.headers['content-type']), /^text\/html/, url);
      assert.match(r.body, /<title>Singgah<\/title>/, url);
    }
    const js = await app.inject({ method: 'GET', url: '/assets/app.js' });
    assert.equal(js.statusCode, 200);
    assert.match(String(js.headers['content-type']), /javascript/);
    for (const url of ['/api/tidak-ada', '/auth/tidak-ada', '/api']) {
      const r = await app.inject({ method: 'GET', url });
      assert.equal(r.statusCode, 404, url);
      assert.match(String(r.headers['content-type']), /^application\/json/, url);
      assert.deepEqual(r.json(), { code: 'NOT_FOUND', message: 'Tidak ditemukan' }, url);
    }
    // API routes still win over the static wildcard
    assert.equal((await app.inject({ method: 'GET', url: '/api/me' })).statusCode, 401);
    for (const url of ['/', '/assets/app.js', '/api/tidak-ada', '/api/me']) {
      const h = (await app.inject({ method: 'GET', url })).headers;
      assert.deepEqual([h['x-frame-options'], h['content-security-policy'], h['referrer-policy']], ['DENY', "frame-ancestors 'none'", 'no-referrer'], url);
    }
  } finally {
    await app.close(); db.close(); rmSync(dir, { recursive: true, force: true });
  }
});
