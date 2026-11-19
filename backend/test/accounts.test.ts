import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.ts';
import { decideSsh, labAccountsFile, requestSsh, revokeSsh, setSshPasswordHash } from '../src/sshstore.ts';
import { syncAccountFiles } from '../src/worker/accounts.ts';

const HASH = '$6$saltsalt$' + 'a'.repeat(86);
process.umask(0o027); // the worker unit runs with UMask=0027

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'singgah-'));
  const db = openDb(join(root, 't.db'));
  const dir = join(root, 'labs');
  const { id: u } = db.prepare(`INSERT INTO users(email,name,role,created_at) VALUES('budi@ugm.ac.id','b','student',0) RETURNING id`).get() as { id: number };
  const done = () => { db.close(); rmSync(root, { recursive: true, force: true }); };
  return { db, dir, u, done };
}

test('writes <dir>/<lab>/accounts for every valid lab, mode 0644, only when changed', () => {
  const t = setup();
  const a = requestSsh(t.db, { userId: t.u, labId: 'lab-cyber', actor: 'b', nowMs: 1 });
  decideSsh(t.db, { id: a.id, approve: true, by: 'adm', reason: null, nowMs: 2 });
  setSshPasswordHash(t.db, { id: a.id, hash: HASH, actor: 'b', nowMs: 3 });
  const r1 = syncAccountFiles(t.db, t.dir);
  assert.deepEqual(r1, { written: ['lab-cloud', 'lab-cyber', 'lab-jarkom'], errors: [] });
  const file = join(t.dir, 'lab-cyber', 'accounts');
  assert.equal(readFileSync(file, 'utf8'), labAccountsFile(t.db, 'lab-cyber'));
  assert.equal(readFileSync(file, 'utf8'), `budi:${10000 + t.u}:${HASH}\n`);
  assert.equal(readFileSync(join(t.dir, 'lab-cloud', 'accounts'), 'utf8'), '');
  assert.equal(statSync(file).mode & 0o777, 0o644);
  assert.equal(statSync(join(t.dir, 'lab-cyber')).mode & 0o777, 0o755);
  assert.deepEqual(syncAccountFiles(t.db, t.dir).written, []);
  revokeSsh(t.db, { id: a.id, by: 'adm', reason: 'x', nowMs: 4 });
  assert.deepEqual(syncAccountFiles(t.db, t.dir).written, ['lab-cyber']);
  assert.equal(readFileSync(file, 'utf8'), '');
  assert.ok(!existsSync(`${file}.tmp`));
  t.done();
});

test('lab id with a path in it is skipped with an error, nothing written outside dir', () => {
  const t = setup();
  t.db.prepare(`INSERT INTO labs(id,name,target_cidr) VALUES('lab-a/../../x','x','192.168.50.0/24')`).run();
  const r = syncAccountFiles(t.db, t.dir);
  assert.equal(r.errors.length, 1);
  assert.deepEqual(r.written, ['lab-cloud', 'lab-cyber', 'lab-jarkom']);
  assert.ok(!existsSync(join(t.dir, '..', 'x')));
  assert.ok(!existsSync(join(t.dir, '..', '..', 'x')));
  t.done();
});
