import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb, assertSchema, SCHEMA_VERSION, SCHEMA_V1 } from '../src/db.ts';

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'singgah-'));
  return { file: path.join(dir, 't.db'), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function setup() {
  const t = tmpDb();
  const db = openDb(t.file);
  db.exec(`INSERT INTO users(id,email,role,created_at) VALUES (1,'a@ugm.ac.id','student',0),(2,'b@ugm.ac.id','student',0)`);
  const lease = (user: number, ip: string, key: string, status: string, ended: number | null = null) =>
    db.prepare(`INSERT INTO leases(user_id,lab_id,tunnel_ip,client_pubkey,status,starts_at,expires_at,ended_at)
      VALUES (?,?,?,?,?,0,1,?)`).run(user, 'lab-cloud', ip, key, status, ended);
  return { t, db, lease };
}

test('seeds three labs', () => {
  const { t, db } = setup();
  const rows = db.prepare('SELECT id,name,target_cidr,max_hours,is_active FROM labs ORDER BY id').all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { id: 'lab-cloud', name: 'Lab Cloud Computing', target_cidr: '192.168.10.0/24', max_hours: 4, is_active: 1 },
    { id: 'lab-cyber', name: 'Lab Cyber Security', target_cidr: '192.168.20.0/24', max_hours: 4, is_active: 1 },
    { id: 'lab-jarkom', name: 'Lab Jaringan Komputer', target_cidr: '192.168.30.0/24', max_hours: 4, is_active: 1 },
  ]);
  db.close(); t.cleanup();
});

test('one ACTIVE lease per user', () => {
  const { t, db, lease } = setup();
  lease(1, '10.8.0.2', 'k1', 'ACTIVE');
  assert.throws(() => lease(1, '10.8.0.3', 'k2', 'ACTIVE'), /UNIQUE/);
  db.close(); t.cleanup();
});

test('tunnel_ip reusable only after ended_at', () => {
  const { t, db, lease } = setup();
  lease(1, '10.8.0.2', 'k1', 'REVOKED', null);
  assert.throws(() => lease(2, '10.8.0.2', 'k2', 'ACTIVE'), /UNIQUE/);
  db.exec(`UPDATE leases SET ended_at=5 WHERE client_pubkey='k1'`);
  lease(2, '10.8.0.2', 'k2', 'ACTIVE');
  db.close(); t.cleanup();
});

test('audit_log is append-only', () => {
  const { t, db } = setup();
  db.exec(`INSERT INTO audit_log(action,actor,at) VALUES ('ISSUED','a',1)`);
  assert.throws(() => db.exec(`UPDATE audit_log SET actor='x'`), /append-only/);
  assert.throws(() => db.exec(`DELETE FROM audit_log`), /append-only/);
  db.close(); t.cleanup();
});

test('busy_timeout and WAL', () => {
  const { t, db } = setup();
  assert.equal(db.prepare('PRAGMA busy_timeout').get()!.timeout, 5000);
  assert.equal(db.prepare('PRAGMA journal_mode').get()!.journal_mode, 'wal');
  db.close(); t.cleanup();
});

test('migrate is idempotent; migrate:false + assertSchema', () => {
  const t = tmpDb();
  openDb(t.file).close();
  const db = openDb(t.file);
  assert.equal(db.prepare('SELECT count(*) c FROM labs').get()!.c, 3);
  db.close();
  const w = openDb(t.file, { migrate: false });
  assertSchema(w);
  w.close();
  const fresh = tmpDb();
  const e = openDb(fresh.file, { migrate: false });
  assert.throws(() => assertSchema(e), /schema/i);
  assert.equal(SCHEMA_VERSION, 2);
  e.close(); t.cleanup(); fresh.cleanup();
});

test('v2: one PENDING/APPROVED ssh account per (user, lab); reopen after REJECTED', () => {
  const { t, db } = setup();
  const ins = (st: string, lab = 'lab-cyber') =>
    db.prepare('INSERT INTO ssh_accounts(user_id,lab_id,status,requested_at) VALUES(1,?,?,0)').run(lab, st);
  ins('PENDING');
  assert.throws(() => ins('APPROVED'), /UNIQUE/);
  ins('PENDING', 'lab-cloud');
  db.exec(`UPDATE ssh_accounts SET status='REJECTED' WHERE lab_id='lab-cyber'`);
  ins('PENDING');
  assert.throws(() => ins('BOGUS', 'lab-jarkom'), /CHECK/);
  db.close(); t.cleanup();
});

test('v2: users.ssh_username unique when set', () => {
  const { t, db } = setup();
  db.exec(`UPDATE users SET ssh_username='budi' WHERE id=1`);
  assert.throws(() => db.exec(`UPDATE users SET ssh_username='budi' WHERE id=2`), /UNIQUE/);
  db.close(); t.cleanup();
});

test('ssh_audit is append-only', () => {
  const { t, db } = setup();
  db.exec(`INSERT INTO ssh_audit(account_id,action,actor,at,detail) VALUES (1,'REQUESTED','a',1,'{}')`);
  assert.throws(() => db.exec(`UPDATE ssh_audit SET actor='x'`), /append-only/);
  assert.throws(() => db.exec(`DELETE FROM ssh_audit`), /append-only/);
  db.close(); t.cleanup();
});

test('migrates a v1 database to v2 keeping rows', () => {
  const t = tmpDb();
  const v1 = new DatabaseSync(t.file);
  v1.exec(SCHEMA_V1); v1.exec('PRAGMA user_version = 1');
  v1.exec(`INSERT INTO users(email,role,created_at) VALUES ('a@ugm.ac.id','student',0)`); v1.close();
  const db = openDb(t.file);
  assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 2);
  assert.equal(db.prepare('SELECT count(*) c FROM users').get()!.c, 1);
  assert.equal(db.prepare('SELECT count(*) c FROM ssh_accounts').get()!.c, 0);
  db.close(); t.cleanup();
});
