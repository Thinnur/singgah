import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.ts';
import { LeaseNotActiveError, createLease, revokeLease } from '../src/leasestore.ts';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'singgah-'));
  const db = openDb(join(dir, 't.db'));
  const { id } = db.prepare("INSERT INTO users(email,name,role,created_at) VALUES('a@ugm.ac.id','a','student',0) RETURNING id").get() as { id: number };
  const mk = (pub: string) => createLease(db, { userId: id, labId: 'lab-cyber', minutes: 60, clientPubkey: pub, requesterIp: null, actor: 'a@ugm.ac.id', nowMs: 1000 });
  return { db, mk, done: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const count = (db: ReturnType<typeof setup>['db'], t: string) => (db.prepare(`SELECT count(*) c FROM ${t}`).get() as { c: number }).c;

test('second createLease for same user: UNIQUE leases.user_id, nothing extra written', () => {
  const t = setup();
  t.mk('k1');
  assert.throws(() => t.mk('k2'), /UNIQUE constraint failed: leases\.user_id/);
  assert.equal(count(t.db, 'leases'), 1);
  assert.equal(count(t.db, 'audit_log'), 1);
  t.done();
});

test('revokeLease on EXPIRED lease throws LeaseNotActiveError, no audit row', () => {
  const t = setup();
  const l = t.mk('k1');
  t.db.prepare("UPDATE leases SET status='EXPIRED' WHERE id=?").run(l.id);
  assert.throws(() => revokeLease(t.db, { leaseId: l.id, by: 'x', reason: 'r', nowMs: 2000 }), LeaseNotActiveError);
  assert.equal(count(t.db, 'audit_log'), 1);
  assert.equal(t.db.isTransaction, false);
  t.done();
});
