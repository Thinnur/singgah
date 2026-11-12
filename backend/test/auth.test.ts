import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.ts';
import { loadConfig } from '../src/config.ts';
import { buildApp } from '../src/api/app.ts';
import { clientIp } from '../src/api/session.ts';

const NOW = Date.UTC(2026, 0, 5, 3, 0, 0);
const GID = 'gid.apps.googleusercontent.com';

function setup(env: Record<string, string> = {}, idToken?: () => Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'singgah-'));
  const db = openDb(join(dir, 't.db'));
  const config = loadConfig({
    TEST_MODE: '1', GOOGLE_CLIENT_ID: GID, GOOGLE_CLIENT_SECRET: 'sec',
    ADMIN_EMAILS: 'boss@ugm.ac.id', ...env,
  });
  const calls: { url: string; body: string }[] = [];
  const fetchFn = (async (url: string, init: { body: string }) => {
    calls.push({ url, body: String(init.body) });
    const p = Buffer.from(JSON.stringify(idToken!())).toString('base64url');
    return new Response(JSON.stringify({ id_token: `h.${p}.s` }), { status: 200 });
  }) as unknown as typeof fetch;
  const app = buildApp({ db, config, fetchFn, now: () => NOW });
  const done = async () => { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); };
  return { app, db, calls, done };
}

const tok = (o: Record<string, unknown> = {}) => ({
  iss: 'https://accounts.google.com', aud: GID, exp: NOW / 1000 + 600,
  email: 'Mhs@mail.ugm.ac.id', email_verified: true, name: 'Mhs', ...o,
});
const cookieOf = (r: { cookies: { name: string; value: string }[] }, n: string) => r.cookies.find((c) => c.name === n);

test('test-login guards', async () => {
  const off = setup({ TEST_MODE: '0' });
  assert.equal((await off.app.inject({ method: 'POST', url: '/auth/test-login', payload: { email: 'a@ugm.ac.id' } })).statusCode, 404);
  await off.done();
  const t = setup();
  const post = (email: string, remoteAddress?: string) =>
    t.app.inject({ method: 'POST', url: '/auth/test-login', payload: { email }, remoteAddress });
  assert.equal((await post('a@ugm.ac.id', '10.0.0.5')).statusCode, 403);
  const bad = await post('a@gmail.com');
  assert.equal(bad.statusCode, 403);
  assert.equal(bad.json().code, 'EMAIL_NOT_ALLOWED');
  const ok = await post('a@ugm.ac.id');
  assert.equal(ok.statusCode, 200);
  assert.ok(cookieOf(ok, 'singgah_sid'));
  await t.done();
});

test('/api/me', async () => {
  const t = setup();
  assert.equal((await t.app.inject({ url: '/api/me' })).statusCode, 401);
  for (const [email, role] of [[' Boss@UGM.ac.id ', 'admin'], ['x@mail.ugm.ac.id', 'student']]) {
    const l = await t.app.inject({ method: 'POST', url: '/auth/test-login', payload: { email } });
    const me = await t.app.inject({ url: '/api/me', cookies: { singgah_sid: cookieOf(l, 'singgah_sid')!.value } });
    assert.equal(me.statusCode, 200);
    const j = me.json();
    assert.equal(j.email, email.trim().toLowerCase());
    assert.equal(j.role, role);
    assert.equal(j.quotaMinutesLeft, 480);
    assert.equal(j.quotaResetsAt, Date.UTC(2026, 0, 5, 17));
  }
  assert.equal((t.db.prepare('SELECT count(*) c FROM users').get() as { c: number }).c, 2);
  await t.done();
});

test('logout: 415 tanpa json, lalu hapus sesi', async () => {
  const t = setup();
  const l = await t.app.inject({ method: 'POST', url: '/auth/test-login', payload: { email: 'a@ugm.ac.id' } });
  const sid = cookieOf(l, 'singgah_sid')!.value;
  const bad = await t.app.inject({ method: 'POST', url: '/auth/logout', headers: { 'content-type': 'text/plain' }, payload: 'x', cookies: { singgah_sid: sid } });
  assert.equal(bad.statusCode, 415);
  assert.equal((await t.app.inject({ method: 'POST', url: '/auth/logout', payload: {}, cookies: { singgah_sid: sid } })).statusCode, 200);
  assert.equal((await t.app.inject({ url: '/api/me', cookies: { singgah_sid: sid } })).statusCode, 401);
  await t.done();
});

test('expired session ditolak', async () => {
  const t = setup();
  const l = await t.app.inject({ method: 'POST', url: '/auth/test-login', payload: { email: 'a@ugm.ac.id' } });
  const sid = cookieOf(l, 'singgah_sid')!.value;
  t.db.prepare('UPDATE sessions SET expires_at=?').run(NOW - 1);
  assert.equal((await t.app.inject({ url: '/api/me', cookies: { singgah_sid: sid } })).statusCode, 401);
  await t.done();
});

test('login redirect + callback', async () => {
  let claims = tok();
  const t = setup({ PUBLIC_URL: 'https://singgah.example' }, () => claims);
  const login = await t.app.inject({ url: '/auth/login' });
  assert.equal(login.statusCode, 302);
  const u = new URL(login.headers.location as string);
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(u.searchParams.get('scope'), 'openid email profile');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://singgah.example/auth/callback');
  const state = u.searchParams.get('state')!;
  assert.equal(cookieOf(login, 'singgah_state')!.value, state);

  const cb = (s = state, code = 'c') =>
    t.app.inject({ url: `/auth/callback?code=${code}&state=${s}`, cookies: { singgah_state: state } });
  assert.equal((await cb('zzz')).headers.location, '/login?error=STATE');
  claims = tok({ aud: 'other' });
  assert.equal((await cb()).headers.location, '/login?error=TOKEN');
  claims = tok({ email_verified: false });
  assert.equal((await cb()).headers.location, '/login?error=TOKEN');
  claims = tok({ email: 'a@gmail.com' });
  assert.equal((await cb()).headers.location, '/login?error=EMAIL_NOT_ALLOWED');
  claims = tok();
  const ok = await cb();
  assert.equal(ok.statusCode, 302);
  assert.equal(ok.headers.location, '/');
  const sid = cookieOf(ok, 'singgah_sid')!;
  assert.ok(sid);
  assert.match(String(ok.headers['set-cookie']), /HttpOnly[\s\S]*Secure|Secure[\s\S]*HttpOnly/);
  assert.equal(t.calls.at(-1)!.url, 'https://oauth2.googleapis.com/token');
  assert.match(t.calls.at(-1)!.body, /grant_type=authorization_code/);
  const me = await t.app.inject({ url: '/api/me', cookies: { singgah_sid: sid.value } });
  assert.equal(me.json().email, 'mhs@mail.ugm.ac.id');
  await t.done();
});

test('clientIp', () => {
  const req = (ra: string) => ({ socket: { remoteAddress: ra }, headers: { 'cf-connecting-ip': '1.2.3.4' }, ip: ra }) as never;
  assert.equal(clientIp(req('100.68.122.86'), '100.68.122.86'), '1.2.3.4');
  assert.equal(clientIp(req('9.9.9.9'), '100.68.122.86'), '9.9.9.9');
});

test('CSRF gate tidak bisa dilewati via path percent-encoded', async () => {
  const t = setup();
  const l = await t.app.inject({ method: 'POST', url: '/auth/test-login', payload: { email: 'a@ugm.ac.id' } });
  const sid = cookieOf(l, 'singgah_sid')!.value;
  for (const url of ['/auth/%6Cogout', '/%61uth/logout']) {
    const r = await t.app.inject({ method: 'POST', url, headers: { 'content-type': 'text/plain' }, payload: 'x', cookies: { singgah_sid: sid } });
    assert.equal(r.statusCode, 415);
  }
  assert.equal((await t.app.inject({ url: '/api/me', cookies: { singgah_sid: sid } })).statusCode, 200);
  await t.done();
});

test('rute tidak dikenal -> ApiError 404; logout body kosong ok', async () => {
  const t = setup();
  const r = await t.app.inject({ url: '/api/nope' });
  assert.equal(r.statusCode, 404);
  assert.deepEqual(r.json(), { code: 'NOT_FOUND', message: 'Tidak ditemukan' });
  const l = await t.app.inject({ method: 'POST', url: '/auth/test-login', payload: { email: 'a@ugm.ac.id' } });
  const sid = cookieOf(l, 'singgah_sid')!.value;
  const out = await t.app.inject({ method: 'POST', url: '/auth/logout', headers: { 'content-type': 'application/json' }, cookies: { singgah_sid: sid } });
  assert.equal(out.statusCode, 200);
  assert.equal((await t.app.inject({ url: '/api/me', cookies: { singgah_sid: sid } })).statusCode, 401);
  await t.done();
});
