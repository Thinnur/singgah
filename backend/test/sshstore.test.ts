import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.ts';
import { decideSsh, labAccountsFile, requestSsh, revokeSsh, setSshPasswordHash } from '../src/sshstore.ts';

const HASH = '$6$saltsalt$' + 'a'.repeat(86);

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'singgah-'));
  const db = openDb(join(dir, 't.db'));
  const user = (email: string) =>
    (db.prepare(`INSERT INTO users(email,name,role,created_at) VALUES(?,?,'student',0) RETURNING id`).get(email, email) as { id: number }).id;
  const row = (id: number) => db.prepare('SELECT * FROM ssh_accounts WHERE id=?').get(id) as Record<string, unknown>;
  const auditActions = (id: number) =>
    (db.prepare('SELECT action FROM ssh_audit WHERE account_id=? ORDER BY id').all(id) as { action: string }[]).map((r) => r.action);
  const done = () => { db.close(); rmSync(dir, { recursive: true, force: true }); };
  return { db, user, row, auditActions, done };
}

test('request: PENDING, username from email kept across labs, audit REQUESTED', () => {
  const t = setup();
  const budi = t.user('budi.santoso@mail.ugm.ac.id');
  const r1 = requestSsh(t.db, { userId: budi, labId: 'lab-cyber', actor: 'budi.santoso@mail.ugm.ac.id', nowMs: 1 });
  assert.equal(r1.username, 'budisantoso');
  assert.equal(t.row(r1.id).status, 'PENDING');
  assert.equal(t.row(r1.id).requested_at, 1);
  assert.equal(requestSsh(t.db, { userId: budi, labId: 'lab-cloud', actor: 'x', nowMs: 2 }).username, 'budisantoso');
  assert.throws(() => requestSsh(t.db, { userId: budi, labId: 'lab-cyber', actor: 'x', nowMs: 3 }), { code: 'ALREADY_OPEN' });
  assert.deepEqual(t.auditActions(r1.id), ['REQUESTED']);
  t.done();
});

test('colliding local parts get distinct names; first keeps its own', () => {
  const t = setup();
  const a = t.user('budi.s@mail.ugm.ac.id');
  const b = t.user('budis@ugm.ac.id');
  assert.equal(requestSsh(t.db, { userId: a, labId: 'lab-cyber', actor: 'a', nowMs: 1 }).username, 'budis');
  assert.equal(requestSsh(t.db, { userId: b, labId: 'lab-cyber', actor: 'b', nowMs: 2 }).username, 'budis2');
  assert.equal(requestSsh(t.db, { userId: a, labId: 'lab-cloud', actor: 'a', nowMs: 3 }).username, 'budis');
  t.done();
});

test('request on inactive or unknown lab -> LAB_UNAVAILABLE, nothing written', () => {
  const t = setup();
  const u = t.user('s@ugm.ac.id');
  t.db.exec(`UPDATE labs SET is_active=0 WHERE id='lab-jarkom'`);
  assert.throws(() => requestSsh(t.db, { userId: u, labId: 'lab-jarkom', actor: 'x', nowMs: 1 }), { code: 'LAB_UNAVAILABLE' });
  assert.throws(() => requestSsh(t.db, { userId: u, labId: 'lab-nope', actor: 'x', nowMs: 1 }), { code: 'LAB_UNAVAILABLE' });
  assert.equal(t.db.prepare('SELECT count(*) c FROM ssh_accounts').get()!.c, 0);
  t.done();
});

test('decide only from PENDING; reapply allowed after REJECTED', () => {
  const t = setup();
  const u = t.user('s@ugm.ac.id');
  const a = requestSsh(t.db, { userId: u, labId: 'lab-cyber', actor: 's', nowMs: 1 });
  decideSsh(t.db, { id: a.id, approve: true, by: 'adm@ugm.ac.id', reason: null, nowMs: 5 });
  assert.equal(t.row(a.id).status, 'APPROVED');
  assert.equal(t.row(a.id).decided_by, 'adm@ugm.ac.id');
  assert.equal(t.row(a.id).decided_at, 5);
  assert.throws(() => decideSsh(t.db, { id: a.id, approve: false, by: 'adm', reason: 'x', nowMs: 6 }), { code: 'NOT_PENDING' });
  const b = requestSsh(t.db, { userId: u, labId: 'lab-cloud', actor: 's', nowMs: 7 });
  decideSsh(t.db, { id: b.id, approve: false, by: 'adm', reason: 'Belum ambil matkul', nowMs: 8 });
  assert.equal(t.row(b.id).status, 'REJECTED');
  assert.equal(t.row(b.id).reason, 'Belum ambil matkul');
  const c = requestSsh(t.db, { userId: u, labId: 'lab-cloud', actor: 's', nowMs: 9 });
  assert.equal(t.row(c.id).status, 'PENDING');
  assert.deepEqual(t.auditActions(b.id), ['REQUESTED', 'REJECTED']);
  t.done();
});

test('revoke only from APPROVED and clears password_hash', () => {
  const t = setup();
  const u = t.user('s@ugm.ac.id');
  const a = requestSsh(t.db, { userId: u, labId: 'lab-cyber', actor: 's', nowMs: 1 });
  assert.throws(() => revokeSsh(t.db, { id: a.id, by: 'adm', reason: 'x', nowMs: 2 }), { code: 'NOT_APPROVED' });
  decideSsh(t.db, { id: a.id, approve: true, by: 'adm', reason: null, nowMs: 3 });
  setSshPasswordHash(t.db, { id: a.id, hash: HASH, actor: 's', nowMs: 4 });
  revokeSsh(t.db, { id: a.id, by: 'adm', reason: 'Selesai praktikum', nowMs: 5 });
  const r = t.row(a.id);
  assert.equal(r.status, 'REVOKED');
  assert.equal(r.password_hash, null);
  assert.equal(r.reason, 'Selesai praktikum');
  assert.deepEqual(t.auditActions(a.id), ['REQUESTED', 'APPROVED', 'PASSWORD_SET', 'REVOKED']);
  t.done();
});

test('setSshPasswordHash only on APPROVED; audit has no hash', () => {
  const t = setup();
  const u = t.user('s@ugm.ac.id');
  const a = requestSsh(t.db, { userId: u, labId: 'lab-cyber', actor: 's', nowMs: 1 });
  assert.throws(() => setSshPasswordHash(t.db, { id: a.id, hash: HASH, actor: 's', nowMs: 2 }), { code: 'NOT_APPROVED' });
  decideSsh(t.db, { id: a.id, approve: true, by: 'adm', reason: null, nowMs: 3 });
  setSshPasswordHash(t.db, { id: a.id, hash: HASH, actor: 's', nowMs: 4 });
  assert.equal(t.row(a.id).password_hash, HASH);
  assert.equal(t.row(a.id).password_set_at, 4);
  for (const { detail } of t.db.prepare('SELECT detail FROM ssh_audit').all() as { detail: string }[]) assert.ok(!detail.includes('$6$'), detail);
  t.done();
});

test('labAccountsFile lists APPROVED accounts of that lab only, skips tampered rows', () => {
  const t = setup();
  const approve = (email: string, lab: string, hash: string | null) => {
    const u = t.user(email);
    const a = requestSsh(t.db, { userId: u, labId: lab, actor: email, nowMs: 1 });
    decideSsh(t.db, { id: a.id, approve: true, by: 'adm', reason: null, nowMs: 2 });
    if (hash) setSshPasswordHash(t.db, { id: a.id, hash, actor: email, nowMs: 3 });
    return { u, a };
  };
  assert.equal(labAccountsFile(t.db, 'lab-cyber'), '');
  const budi = approve('budisantoso@ugm.ac.id', 'lab-cyber', HASH);
  const ani = approve('ani@ugm.ac.id', 'lab-cyber', null);
  approve('cloudonly@ugm.ac.id', 'lab-cloud', HASH);
  const pend = t.user('pending@ugm.ac.id');
  requestSsh(t.db, { userId: pend, labId: 'lab-cyber', actor: 'p', nowMs: 1 });
  assert.equal(labAccountsFile(t.db, 'lab-cyber'), `ani:${10000 + ani.u}:\nbudisantoso:${10000 + budi.u}:${HASH}\n`);
  t.db.prepare(`UPDATE users SET ssh_username='root;x' WHERE id=?`).run(ani.u);
  t.db.prepare(`UPDATE ssh_accounts SET password_hash='plaintext' WHERE id=?`).run(budi.a.id);
  assert.equal(labAccountsFile(t.db, 'lab-cyber'), '');
  t.done();
});
