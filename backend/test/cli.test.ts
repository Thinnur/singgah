import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.ts';

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
