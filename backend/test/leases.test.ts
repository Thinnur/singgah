import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.ts';
import { loadConfig } from '../src/config.ts';
import { buildApp } from '../src/api/app.ts';

const NOW = Date.UTC(2026, 0, 5, 3, 0, 0);

function setup(testMode = true) {
  const dir = mkdtempSync(join(tmpdir(), 'singgah-'));
  const db = openDb(join(dir, 't.db'));
  const config = loadConfig({ TEST_MODE: testMode ? '1' : '0', GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's' });
  const app = buildApp({ db, config, now: () => NOW });
  const user = (email: string) => {
    const { id } = db.prepare("INSERT INTO users(email,name,role,created_at) VALUES(?,?,'student',0) RETURNING id").get(email, email) as { id: number };
    db.prepare('INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,?)').run(`sid-${email}`, id, NOW + 1e9);
    return { id, email, cookies: { singgah_sid: `sid-${email}` } };
  };
  const issue = (u: { cookies: Record<string, string> }, body: unknown = { labId: 'lab-cyber', minutes: 60 }, extra: object = {}) =>
    app.inject({ method: 'POST', url: '/api/leases', payload: body as object, cookies: u.cookies, ...extra });
  const done = async () => { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); };
  return { app, db, user, issue, done };
}

test('issue: config, no private key stored, current view', async () => {
  const t = setup();
  const u = t.user('a@ugm.ac.id');
  const r = await t.issue(u);
  assert.equal(r.statusCode, 201);
  const b = r.json();
  assert.equal(b.filename, 'singgah-lab-cyber.conf');
  assert.match(b.config, /Address = 10\.8\.0\.2\/32/);
  assert.match(b.config, /AllowedIPs = 10\.8\.0\.1\/32, 192\.168\.20\.0\/24/);
  assert.equal(b.lease.peerActive, false);
  const priv = /PrivateKey = (\S+)/.exec(b.config)![1];
  const dump = JSON.stringify([t.db.prepare('SELECT * FROM leases').all(), t.db.prepare('SELECT * FROM audit_log').all()]);
  assert.ok(!dump.includes(priv));
  const cur = await t.app.inject({ url: '/api/leases/current', cookies: u.cookies });
  assert.ok(!cur.body.includes('PrivateKey'));
  assert.equal(cur.json().tunnelIp, '10.8.0.2');
  await t.done();
});

test('double submit: one 201, one 409 HAS_ACTIVE', async () => {
  const t = setup();
  const u = t.user('a@ugm.ac.id');
  const rs = await Promise.all([t.issue(u), t.issue(u)]);
  assert.deepEqual(rs.map((r) => r.statusCode).sort(), [201, 409]);
  assert.equal(rs.find((r) => r.statusCode === 409)!.json().code, 'HAS_ACTIVE');
  await t.done();
});

test('rejections', async () => {
  const t = setup();
  const u = t.user('a@ugm.ac.id');
  t.db.prepare("UPDATE labs SET is_active=0 WHERE id='lab-cloud'").run();
  assert.equal((await t.issue(u, { labId: 'lab-cloud', minutes: 60 })).statusCode, 404);
  assert.equal((await t.issue(u, { labId: 'lab-nope', minutes: 60 })).statusCode, 404);
  t.db.prepare("UPDATE labs SET max_hours=2 WHERE id='lab-cyber'").run();
  assert.equal((await t.issue(u, { labId: 'lab-cyber', minutes: 240 })).statusCode, 400);
  assert.equal((await t.issue(u, { labId: 'lab-cyber' })).statusCode, 400);
  assert.equal((await t.issue(u, { labId: 5, minutes: '60' })).statusCode, 400);
  assert.equal((await t.app.inject({ method: 'POST', url: '/api/leases', cookies: u.cookies, headers: { 'content-type': 'application/json' }, payload: '' })).statusCode, 400);
  assert.equal((await t.app.inject({ method: 'POST', url: '/api/leases', payload: {} })).statusCode, 401);
  await t.done();

  const off = setup(false);
  assert.equal((await off.issue(off.user('a@ugm.ac.id'), { labId: 'lab-cyber', minutes: 1 })).statusCode, 400);
  await off.done();
});

test('quota exhausted -> 429', async () => {
  const t = setup();
  const u = t.user('a@ugm.ac.id');
  t.db.prepare("INSERT INTO leases(user_id,lab_id,tunnel_ip,client_pubkey,status,starts_at,expires_at,ended_at) VALUES(?,?,?,?,'EXPIRED',?,?,?)")
    .run(u.id, 'lab-cyber', '10.8.0.99', 'k', NOW - 450 * 60_000, NOW, NOW);
  const r = await t.issue(u);
  assert.equal(r.statusCode, 429);
  assert.match(r.json().message, /00\.00 WIB/);
  await t.done();
});

test('pool full -> 503', async () => {
  const t = setup();
  const ins = t.db.prepare("INSERT INTO leases(user_id,lab_id,tunnel_ip,client_pubkey,status,starts_at,expires_at) VALUES(?,?,?,?,'ACTIVE',?,?)");
  for (let i = 2; i <= 254; i++) ins.run(t.user(`u${i}@ugm.ac.id`).id, 'lab-cyber', `10.8.0.${i}`, `k${i}`, NOW, NOW + 3600_000);
  const r = await t.issue(t.user('late@ugm.ac.id'));
  assert.equal(r.statusCode, 503);
  assert.equal(r.json().code, 'POOL_FULL');
  await t.done();
});

test('release: owner only, audit, IP not reused and no new lease until ended', async () => {
  const t = setup();
  const a = t.user('a@ugm.ac.id');
  const o = t.user('o@ugm.ac.id');
  const { lease } = (await t.issue(a)).json();
  const rel = (u: { cookies: Record<string, string> }) => t.app.inject({ method: 'POST', url: `/api/leases/${lease.id}/release`, payload: {}, cookies: u.cookies });
  assert.equal((await rel(o)).statusCode, 404);
  assert.equal((await rel(a)).statusCode, 200);
  const row = t.db.prepare('SELECT status,revoked_by,reason,revoked_at FROM leases WHERE id=?').get(lease.id) as Record<string, unknown>;
  assert.deepEqual({ ...row }, { status: 'REVOKED', revoked_by: 'a@ugm.ac.id', reason: 'Dilepas pemohon', revoked_at: NOW });
  const au = t.db.prepare("SELECT actor FROM audit_log WHERE action='REVOKED'").all();
  assert.equal(au.length, 1);
  assert.equal(au[0].actor, 'a@ugm.ac.id');
  assert.equal((await rel(a)).statusCode, 409);
  // until the worker closes it (ended_at), the old lease still holds its IP: no new lease for the same user
  const early = await t.issue(a);
  assert.equal(early.statusCode, 409);
  assert.equal(early.json().code, 'PREV_CLOSING');
  assert.match(early.json().message, /masih ditutup/);
  const other = await t.issue(o);
  assert.equal(other.statusCode, 201);
  assert.notEqual(other.json().lease.tunnelIp, lease.tunnelIp);
  t.db.prepare('UPDATE leases SET ended_at=? WHERE id=?').run(NOW, lease.id);
  assert.equal((await t.issue(a)).statusCode, 201);
  await t.done();
});

test('requester ip via trusted proxy; labs list', async () => {
  const t = setup();
  const u = t.user('a@ugm.ac.id');
  const r = await t.issue(u, undefined, { remoteAddress: '127.0.0.1', headers: { 'cf-connecting-ip': '36.1.2.3', 'content-type': 'application/json' } });
  assert.equal(r.statusCode, 201);
  const d = JSON.parse((t.db.prepare("SELECT detail FROM audit_log WHERE action='ISSUED'").get() as { detail: string }).detail);
  assert.equal(d.requesterIp, '36.1.2.3');
  assert.equal(d.email, 'a@ugm.ac.id');
  const labs = (await t.app.inject({ url: '/api/labs', cookies: u.cookies })).json();
  assert.equal(labs.length, 3);
  assert.deepEqual(labs[0].durations, [1, 60, 120, 240]);
  await t.done();
});
