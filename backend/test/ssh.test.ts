import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.ts';
import { loadConfig } from '../src/config.ts';
import { buildApp } from '../src/api/app.ts';
import { SHA512_CRYPT } from '../src/sshcred.ts';
import type { AdminSshAccount, SshAuditEntry, SshLabView, SshPasswordResponse } from '../src/api/types.ts';

let NOW = Date.UTC(2026, 0, 5, 3, 0, 0);
const PW = /^[a-kmnp-z2-9]{4}(-[a-kmnp-z2-9]{4}){3}$/;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'singgah-'));
  const db = openDb(join(dir, 't.db'));
  const config = loadConfig({ TEST_MODE: '1', GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's' });
  const app = buildApp({ db, config, now: () => NOW, sysNetDir: join(dir, 'net') });
  const user = (email: string, role: 'student' | 'admin') => {
    const { id } = db.prepare('INSERT INTO users(email,name,role,created_at) VALUES(?,?,?,0) RETURNING id').get(email, email, role) as { id: number };
    db.prepare('INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,?)').run(`sid-${email}`, id, NOW + 1e9);
    return { id, email, cookies: { singgah_sid: `sid-${email}` } };
  };
  const admin = user('adm@ugm.ac.id', 'admin');
  const stu = user('s@ugm.ac.id', 'student');
  type U = typeof stu;
  const post = (u: U, url: string, payload: object = {}) => app.inject({ method: 'POST', url, payload, cookies: u.cookies });
  const get = (u: U, url: string) => app.inject({ url, cookies: u.cookies });
  const request = (u: U, labId = 'lab-cyber') => post(u, '/api/ssh', { labId });
  const accountId = async (u: U, labId = 'lab-cyber') =>
    (((await get(u, '/api/ssh')).json() as SshLabView[]).find((l) => l.labId === labId)!.account!).id;
  const done = async () => { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); };
  return { app, db, admin, stu, user, post, get, request, accountId, done };
}

test('unauthenticated 401 on /api/ssh; student 403 on every admin ssh route', async () => {
  const t = setup();
  assert.equal((await t.app.inject({ url: '/api/ssh' })).statusCode, 401);
  for (const [method, url] of [['GET', '/api/admin/ssh'], ['GET', '/api/admin/ssh/audit'], ['POST', '/api/admin/ssh/1/approve'],
    ['POST', '/api/admin/ssh/1/reject'], ['POST', '/api/admin/ssh/1/revoke']] as const) {
    const r = await t.app.inject({ method, url, cookies: t.stu.cookies, payload: method === 'POST' ? {} : undefined });
    assert.equal(r.statusCode, 403, `${method} ${url}`);
  }
  await t.done();
});

test('full flow: request -> approve -> password -> revoke', async () => {
  const t = setup();
  const r = await t.request(t.stu);
  assert.equal(r.statusCode, 201, r.body);
  const view = r.json() as SshLabView;
  assert.deepEqual({ labId: view.labId, host: view.host, status: view.account?.status, username: view.account?.username },
    { labId: 'lab-cyber', host: '192.168.20.10', status: 'PENDING', username: 's' });
  const id = view.account!.id;

  assert.equal((await t.post(t.admin, `/api/admin/ssh/${id}/approve`)).statusCode, 200);
  let mine = (await t.get(t.stu, '/api/ssh')).json() as SshLabView[];
  assert.deepEqual(mine.map((l) => l.labId), ['lab-cloud', 'lab-cyber', 'lab-jarkom']);
  const cyber = mine.find((l) => l.labId === 'lab-cyber')!;
  assert.equal(cyber.account!.status, 'APPROVED');
  assert.equal(cyber.account!.passwordSet, false);
  assert.equal(mine.find((l) => l.labId === 'lab-cloud')!.account, null);

  const p = await t.post(t.stu, `/api/ssh/${id}/password`);
  assert.equal(p.statusCode, 200, p.body);
  const pw = p.json() as SshPasswordResponse;
  assert.equal(pw.username, 's');
  assert.equal(pw.host, '192.168.20.10');
  assert.match(pw.password, PW);
  const { password_hash } = t.db.prepare('SELECT password_hash FROM ssh_accounts WHERE id=?').get(id) as { password_hash: string };
  assert.match(password_hash, SHA512_CRYPT);
  assert.ok(!password_hash.includes(pw.password));
  for (const { detail } of t.db.prepare('SELECT detail FROM ssh_audit').all() as { detail: string }[]) {
    assert.ok(!detail.includes(pw.password) && !detail.includes('$6$'), detail);
  }
  mine = (await t.get(t.stu, '/api/ssh')).json() as SshLabView[];
  assert.equal(mine.find((l) => l.labId === 'lab-cyber')!.account!.passwordSet, true);

  assert.equal((await t.post(t.admin, `/api/admin/ssh/${id}/revoke`, { reason: 'Selesai praktikum' })).statusCode, 200);
  const after = ((await t.get(t.stu, '/api/ssh')).json() as SshLabView[]).find((l) => l.labId === 'lab-cyber')!.account!;
  assert.equal(after.status, 'REVOKED');
  assert.equal(after.reason, 'Selesai praktikum');
  await t.done();
});

test('two concurrent requests for one lab -> exactly one 201, one 409 ALREADY_REQUESTED', async () => {
  const t = setup();
  const [a, b] = await Promise.all([t.request(t.stu), t.request(t.stu)]);
  assert.deepEqual([a.statusCode, b.statusCode].sort(), [201, 409]);
  assert.equal([a, b].find((r) => r.statusCode === 409)!.json().code, 'ALREADY_REQUESTED');
  assert.equal(t.db.prepare('SELECT count(*) c FROM ssh_accounts').get()!.c, 1);
  await t.done();
});

test('another student cannot make a password for my account -> 404', async () => {
  const t = setup();
  await t.request(t.stu);
  const id = await t.accountId(t.stu);
  await t.post(t.admin, `/api/admin/ssh/${id}/approve`);
  const other = t.user('o@ugm.ac.id', 'student');
  const r = await t.post(other, `/api/ssh/${id}/password`);
  assert.equal(r.statusCode, 404);
  assert.equal(t.db.prepare('SELECT password_hash FROM ssh_accounts WHERE id=?').get(id)!.password_hash, null);
  await t.done();
});

test('password: 409 before approval; twice within 10 s -> 429 TOO_SOON; after 10 s -> 200 and hash changes', async () => {
  const t = setup();
  await t.request(t.stu);
  const id = await t.accountId(t.stu);
  const early = await t.post(t.stu, `/api/ssh/${id}/password`);
  assert.equal(early.statusCode, 409);
  assert.equal(early.json().code, 'NOT_APPROVED');
  await t.post(t.admin, `/api/admin/ssh/${id}/approve`);
  assert.equal((await t.post(t.stu, `/api/ssh/${id}/password`)).statusCode, 200);
  const h1 = t.db.prepare('SELECT password_hash FROM ssh_accounts WHERE id=?').get(id)!.password_hash;
  NOW += 5_000;
  const soon = await t.post(t.stu, `/api/ssh/${id}/password`);
  assert.equal(soon.statusCode, 429);
  assert.equal(soon.json().code, 'TOO_SOON');
  NOW += 5_000;
  assert.equal((await t.post(t.stu, `/api/ssh/${id}/password`)).statusCode, 200);
  assert.notEqual(t.db.prepare('SELECT password_hash FROM ssh_accounts WHERE id=?').get(id)!.password_hash, h1);
  await t.done();
});

test('approve a rejected request -> 409 NOT_PENDING; revoke a pending one -> 409 NOT_APPROVED; data unchanged', async () => {
  const t = setup();
  await t.request(t.stu);
  const id = await t.accountId(t.stu);
  const rev = await t.post(t.admin, `/api/admin/ssh/${id}/revoke`, { reason: 'x' });
  assert.equal(rev.statusCode, 409);
  assert.equal(rev.json().code, 'NOT_APPROVED');
  assert.equal((await t.post(t.admin, `/api/admin/ssh/${id}/reject`, { reason: 'Belum ambil matkul' })).statusCode, 200);
  const app2 = await t.post(t.admin, `/api/admin/ssh/${id}/approve`);
  assert.equal(app2.statusCode, 409);
  assert.equal(app2.json().code, 'NOT_PENDING');
  const row = t.db.prepare('SELECT status, reason FROM ssh_accounts WHERE id=?').get(id) as { status: string; reason: string };
  assert.deepEqual({ ...row }, { status: 'REJECTED', reason: 'Belum ambil matkul' });
  assert.equal((await t.post(t.admin, '/api/admin/ssh/999/approve')).statusCode, 404);
  await t.done();
});

test('reject/revoke with blank reason -> 400', async () => {
  const t = setup();
  await t.request(t.stu);
  const id = await t.accountId(t.stu);
  assert.equal((await t.post(t.admin, `/api/admin/ssh/${id}/reject`, { reason: '  ' })).statusCode, 400);
  await t.post(t.admin, `/api/admin/ssh/${id}/approve`);
  assert.equal((await t.post(t.admin, `/api/admin/ssh/${id}/revoke`, {})).statusCode, 400);
  await t.done();
});

test('inactive lab: POST -> 404 LAB_UNAVAILABLE and lab absent from GET /api/ssh; bad body -> 400', async () => {
  const t = setup();
  t.db.exec(`UPDATE labs SET is_active=0 WHERE id='lab-jarkom'`);
  const r = await t.request(t.stu, 'lab-jarkom');
  assert.equal(r.statusCode, 404);
  assert.equal(r.json().code, 'LAB_UNAVAILABLE');
  assert.ok(!((await t.get(t.stu, '/api/ssh')).json() as SshLabView[]).some((l) => l.labId === 'lab-jarkom'));
  assert.equal((await t.post(t.stu, '/api/ssh', { labId: 5 })).statusCode, 400);
  await t.done();
});

test('admin list: PENDING oldest first; ?status=BOGUS -> 400; audit lists REQUESTED/APPROVED/PASSWORD_SET', async () => {
  const t = setup();
  await t.request(t.stu, 'lab-cyber');
  NOW += 1000;
  const other = t.user('o@ugm.ac.id', 'student');
  await t.request(other, 'lab-cyber');
  const pend = (await t.get(t.admin, '/api/admin/ssh')).json() as AdminSshAccount[];
  assert.deepEqual(pend.map((a) => [a.email, a.username, a.labName, a.status]),
    [['s@ugm.ac.id', 's', 'Lab Cyber Security', 'PENDING'], ['o@ugm.ac.id', 'o', 'Lab Cyber Security', 'PENDING']]);
  assert.equal((await t.get(t.admin, '/api/admin/ssh?status=BOGUS')).statusCode, 400);
  await t.post(t.admin, `/api/admin/ssh/${pend[0].id}/approve`);
  await t.post(t.stu, `/api/ssh/${pend[0].id}/password`);
  const approved = (await t.get(t.admin, '/api/admin/ssh?status=APPROVED')).json() as AdminSshAccount[];
  assert.deepEqual(approved.map((a) => [a.id, a.decidedBy, a.passwordSet]), [[pend[0].id, 'adm@ugm.ac.id', true]]);
  const audit = (await t.get(t.admin, '/api/admin/ssh/audit')).json() as SshAuditEntry[];
  assert.deepEqual(audit.filter((e) => e.accountId === pend[0].id).map((e) => e.action), ['PASSWORD_SET', 'APPROVED', 'REQUESTED']);
  assert.equal(audit[0].detail.email, 's@ugm.ac.id');
  await t.done();
});
