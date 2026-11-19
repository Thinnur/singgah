import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.ts';
import { SHA512_CRYPT } from '../src/sshcred.ts';

const CLI = fileURLToPath(new URL('../src/cli/lease.ts', import.meta.url));
const PUB = Buffer.alloc(32, 1).toString('base64');

test('cli/lease.ts add + revoke use the shared lease store with actor selftest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'singgah-'));
  const dbPath = join(dir, 't.db');
  openDb(dbPath).close();
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, TEST_MODE: '1', DB_PATH: dbPath } });

  const add = run('add', '--email', 'Selftest@Example.com', '--lab', 'lab-cyber', '--pubkey', PUB, '--minutes', '1');
  assert.equal(add.status, 0, add.stderr);
  assert.equal(add.stdout, '1 10.8.0.2\n');

  const again = run('add', '--email', 'selftest@example.com', '--lab', 'lab-cyber', '--pubkey', Buffer.alloc(32, 2).toString('base64'), '--minutes', '1');
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /user_id/);

  const badLab = run('add', '--email', 'other@example.com', '--lab', 'lab-nope', '--pubkey', Buffer.alloc(32, 3).toString('base64'), '--minutes', '1');
  assert.notEqual(badLab.status, 0);
  assert.match(badLab.stderr, /lab-nope/);

  const rev = run('revoke', '--id', '1', '--reason', 'uji mandiri');
  assert.equal(rev.status, 0, rev.stderr);
  const revAgain = run('revoke', '--id', '1', '--reason', 'uji mandiri');
  assert.notEqual(revAgain.status, 0);
  assert.match(revAgain.stderr, /tidak aktif/);

  const db = openDb(dbPath);
  assert.deepEqual({ ...db.prepare('SELECT email, role FROM users').get() }, { email: 'selftest@example.com', role: 'student' });
  assert.deepEqual(db.prepare('SELECT action, actor FROM audit_log ORDER BY id').all().map((r) => ({ ...r })), [
    { action: 'ISSUED', actor: 'selftest' },
    { action: 'REVOKED', actor: 'selftest' },
  ]);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('cli ssh-grant approves with a password hash; a second grant replaces the open account; ssh-revoke', () => {
  const dir = mkdtempSync(join(tmpdir(), 'singgah-'));
  const dbPath = join(dir, 't.db');
  openDb(dbPath).close();
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, TEST_MODE: '1', DB_PATH: dbPath } });
  const row = (id: string) => {
    const db = openDb(dbPath);
    const r = db.prepare('SELECT status, password_hash, decided_by FROM ssh_accounts WHERE id=?').get(Number(id)) as
      { status: string; password_hash: string | null; decided_by: string };
    db.close();
    return r;
  };

  const g = run('ssh-grant', '--email', 'selftest1@local', '--lab', 'lab-cyber', '--password', 'abcd-efgh-ijkm-npqr');
  assert.equal(g.status, 0, g.stderr);
  assert.match(g.stdout, /^\d+ selftest1\n$/);
  const id1 = g.stdout.split(' ')[0];
  assert.equal(row(id1).status, 'APPROVED');
  assert.equal(row(id1).decided_by, 'selftest');
  assert.match(row(id1).password_hash!, SHA512_CRYPT);

  const g2 = run('ssh-grant', '--email', 'selftest1@local', '--lab', 'lab-cyber', '--password', 'x');
  assert.equal(g2.status, 0, g2.stderr);
  const id2 = g2.stdout.split(' ')[0];
  assert.notEqual(id2, id1);
  assert.equal(row(id1).status, 'REVOKED');
  assert.equal(row(id2).status, 'APPROVED');

  const r = run('ssh-revoke', '--id', id2, '--reason', 'selftest');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(row(id2).status, 'REVOKED');
  const bad = run('ssh-grant', '--email', 'selftest1@local', '--lab', 'lab-cyber');
  assert.notEqual(bad.status, 0);
  rmSync(dir, { recursive: true, force: true });
});
