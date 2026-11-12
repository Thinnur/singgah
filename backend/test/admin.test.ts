import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.ts';
import { loadConfig } from '../src/config.ts';
import { buildApp } from '../src/api/app.ts';

let NOW = Date.UTC(2026, 0, 5, 3, 0, 0);

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'singgah-'));
  const db = openDb(join(dir, 't.db'));
  const config = loadConfig({ TEST_MODE: '1', GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's' });
  const sysNetDir = join(dir, 'net');
  const app = buildApp({ db, config, now: () => NOW, sysNetDir });
  const user = (email: string, role: 'student' | 'admin') => {
    const { id } = db.prepare('INSERT INTO users(email,name,role,created_at) VALUES(?,?,?,0) RETURNING id').get(email, email, role) as { id: number };
    db.prepare('INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,?)').run(`sid-${email}`, id, NOW + 1e9);
    return { id, email, cookies: { singgah_sid: `sid-${email}` } };
  };
  const admin = user('adm@ugm.ac.id', 'admin');
  const stu = user('s@ugm.ac.id', 'student');
  const issue = (u: typeof stu, labId = 'lab-cyber') =>
    app.inject({ method: 'POST', url: '/api/leases', payload: { labId, minutes: 60 }, cookies: u.cookies });
  const done = async () => { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); };
  return { app, db, admin, stu, user, issue, done, sysNetDir };
}
const J = { 'content-type': 'application/json' };

test('non-admin gets 403 on every admin route', async () => {
  const t = setup();
  for (const [method, url] of [['GET', '/api/admin/leases'], ['POST', '/api/admin/leases/1/revoke'], ['GET', '/api/admin/labs'],
    ['POST', '/api/admin/labs'], ['PATCH', '/api/admin/labs/lab-cyber'], ['GET', '/api/admin/audit'], ['GET', '/api/admin/stats']] as const) {
    const r = await t.app.inject({ method, url, cookies: t.stu.cookies, headers: J, payload: {} });
    assert.equal(r.statusCode, 403, `${method} ${url}`);
  }
  await t.done();
});

test('list leases: default ACTIVE with email, status filter', async () => {
  const t = setup();
  await t.issue(t.stu);
  const r = await t.app.inject({ url: '/api/admin/leases', cookies: t.admin.cookies });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().length, 1);
  assert.equal(r.json()[0].email, 's@ugm.ac.id');
  assert.equal(r.json()[0].labName, 'Lab Cyber Security');
  const e = await t.app.inject({ url: '/api/admin/leases?status=EXPIRED', cookies: t.admin.cookies });
  assert.deepEqual(e.json(), []);
  assert.equal((await t.app.inject({ url: '/api/admin/leases?status=X', cookies: t.admin.cookies })).statusCode, 400);
  await t.done();
});

test('revoke: blank reason 400, valid -> REVOKED + audit, again -> 409', async () => {
  const t = setup();
  const id = (await t.issue(t.stu)).json().lease.id;
  const url = `/api/admin/leases/${id}/revoke`;
  const post = (payload: object) => t.app.inject({ method: 'POST', url, cookies: t.admin.cookies, headers: J, payload });
  assert.equal((await post({})).statusCode, 400);
  assert.equal((await post({ reason: '   ' })).statusCode, 400);
  assert.equal((await post({ reason: '  Menyalahgunakan  ' })).statusCode, 200);
  const l = t.db.prepare('SELECT status,revoked_by,reason FROM leases WHERE id=?').get(id) as Record<string, string>;
  assert.deepEqual({ ...l }, { status: 'REVOKED', revoked_by: 'adm@ugm.ac.id', reason: 'Menyalahgunakan' });
  const a = t.db.prepare("SELECT actor,detail FROM audit_log WHERE action='REVOKED'").get() as { actor: string; detail: string };
  assert.equal(a.actor, 'adm@ugm.ac.id');
  assert.equal(JSON.parse(a.detail).reason, 'Menyalahgunakan');
  assert.equal((await post({ reason: 'lagi' })).statusCode, 409);
  assert.equal((await t.app.inject({ method: 'POST', url: '/api/admin/leases/999/revoke', cookies: t.admin.cookies, headers: J, payload: { reason: 'x' } })).statusCode, 404);
  await t.done();
});

test('labs: add validation', async () => {
  const t = setup();
  const add = (p: object) => t.app.inject({ method: 'POST', url: '/api/admin/labs', cookies: t.admin.cookies, headers: J, payload: p });
  const ok = { id: 'lab-baru', name: 'Lab Baru', targetCidr: '192.168.40.0/24', maxHours: 2 };
  const r = await add(ok);
  assert.equal(r.statusCode, 201);
  assert.equal(r.json().targetCidr, '192.168.40.0/24');
  assert.equal(r.json().isActive, true);
  assert.equal((await add(ok)).statusCode, 409);
  const bad = (o: object) => add({ ...ok, id: 'lab-x2', targetCidr: '192.168.50.0/24', ...o });
  assert.equal((await bad({ targetCidr: '192.168.20.0/25' })).statusCode, 400); // overlaps lab-cyber
  assert.equal((await bad({ targetCidr: '172.18.0.0/16' })).statusCode, 400); // docker
  assert.equal((await bad({ targetCidr: 'nope' })).statusCode, 400);
  assert.equal((await bad({ id: 'Lab_X' })).statusCode, 400);
  assert.equal((await bad({ id: 'lab-' + 'a'.repeat(21) })).statusCode, 400);
  assert.equal((await bad({ maxHours: 3 })).statusCode, 400);
  assert.equal((await bad({ name: ' ' })).statusCode, 400);
  const list = await t.app.inject({ url: '/api/admin/labs', cookies: t.admin.cookies });
  assert.equal(list.json().length, 4);
  await t.done();
});

test('patch lab: deactivate keeps active lease, blocks new requests; CIDR immutable', async () => {
  const t = setup();
  const lease = (await t.issue(t.stu)).json().lease;
  const patch = (p: object) => t.app.inject({ method: 'PATCH', url: '/api/admin/labs/lab-cyber', cookies: t.admin.cookies, headers: J, payload: p });
  const r = await patch({ isActive: false, name: 'Baru', maxHours: 1 });
  assert.equal(r.statusCode, 200);
  assert.deepEqual([r.json().isActive, r.json().name, r.json().maxHours], [false, 'Baru', 1]);
  assert.equal((await patch({ targetCidr: '192.168.99.0/24' })).statusCode, 400);
  assert.equal((await patch({ maxHours: 3 })).statusCode, 400);
  assert.equal((await patch({ isActive: 'ya' })).statusCode, 400);
  assert.equal((await t.app.inject({ method: 'PATCH', url: '/api/admin/labs/lab-nope', cookies: t.admin.cookies, headers: J, payload: { name: 'x' } })).statusCode, 404);
  assert.equal((t.db.prepare('SELECT status FROM leases WHERE id=?').get(lease.id) as { status: string }).status, 'ACTIVE');
  const other = t.user('o@ugm.ac.id', 'student');
  assert.equal((await t.issue(other)).statusCode, 404);
  await t.done();
});

test('audit: filters by ip, email, from/to; newest first', async () => {
  const t = setup();
  const o = t.user('o@ugm.ac.id', 'student');
  await t.issue(t.stu); // 10.8.0.2
  NOW += 60_000;
  await t.issue(o); // 10.8.0.3
  const get = async (q: string) => (await t.app.inject({ url: `/api/admin/audit${q}`, cookies: t.admin.cookies })).json();
  const all = await get('');
  assert.equal(all.length, 2);
  assert.ok(all[0].at > all[1].at);
  assert.equal(all[0].detail.tunnelIp, '10.8.0.3');
  const byIp = await get('?ip=10.8.0.2');
  assert.deepEqual(byIp.map((e: { detail: { email: string } }) => e.detail.email), ['s@ugm.ac.id']);
  assert.equal((await get('?email=o@ugm.ac.id')).length, 1);
  assert.equal((await get(`?from=${NOW}`)).length, 1);
  assert.equal((await get(`?to=${NOW - 1}`)).length, 1);
  assert.equal((await t.app.inject({ url: '/api/admin/audit?from=abc', cookies: t.admin.cookies })).statusCode, 400);
  await t.done();
});

test('stats: counts and wg0 throughput from injected sysfs', async () => {
  const t = setup();
  await t.issue(t.stu);
  const stats = async () => (await t.app.inject({ url: '/api/admin/stats', cookies: t.admin.cookies })).json();
  let s = await stats();
  assert.equal(s.activeLeases, 1);
  assert.deepEqual(s.perLab.find((l: { labId: string }) => l.labId === 'lab-cyber'), { labId: 'lab-cyber', labName: 'Lab Cyber Security', leases: 1, minutes: 60 });
  assert.equal(s.wg0, null); // no files
  const w = (rx: number, tx: number) => {
    mkdirSync(join(t.sysNetDir, 'wg0', 'statistics'), { recursive: true });
    writeFileSync(join(t.sysNetDir, 'wg0', 'statistics', 'rx_bytes'), `${rx}\n`);
    writeFileSync(join(t.sysNetDir, 'wg0', 'statistics', 'tx_bytes'), `${tx}\n`);
  };
  w(1000, 2000);
  assert.equal((await stats()).wg0, null); // first sample
  NOW += 10_000;
  w(2000, 2500);
  assert.deepEqual((await stats()).wg0, { rxBps: 100, txBps: 50 });
  await t.done();
});
