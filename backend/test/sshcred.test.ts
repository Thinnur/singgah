import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { RESERVED_USERNAMES, SHA512_CRYPT, SSH_USERNAME, generatePassword, hashPassword, sshUsernameFor } from '../src/sshcred.ts';

const none = () => false;

test('sshUsernameFor normalises the local part', () => {
  assert.equal(sshUsernameFor('Budi.Santoso@mail.ugm.ac.id', none), 'budisantoso');
  assert.equal(sshUsernameFor('22.123+lab@ugm.ac.id', none), 'u22123lab');
  assert.equal(sshUsernameFor('...@ugm.ac.id', none), 'user');
  assert.equal(sshUsernameFor(`${'a'.repeat(40)}@ugm.ac.id`, none), 'a'.repeat(28));
});

test('sshUsernameFor skips reserved and taken names', () => {
  assert.equal(sshUsernameFor('root@ugm.ac.id', none), 'root2');
  assert.equal(sshUsernameFor('budis@ugm.ac.id', (n) => n === 'budis' || n === 'budis2'), 'budis3');
  for (const r of ['root', 'sshd', 'nobody', 'admin', 'ubuntu', 'singgah']) assert.ok(RESERVED_USERNAMES.has(r), r);
});

test('Debian base group names are reserved (groupadd would fail forever)', () => {
  for (const g of ['staff', 'users', 'sudo', 'video', 'audio', 'adm', 'shadow', 'disk', 'tty', 'nogroup', 'utmp', 'plugdev']) {
    assert.equal(sshUsernameFor(`${g}@ugm.ac.id`, none), `${g}2`, g);
  }
});

test('every derived username matches SSH_USERNAME', () => {
  for (const e of ['A@x', '9@x', 'x.y-z_w@x', `${'9'.repeat(50)}@x`, '@x']) assert.match(sshUsernameFor(e, none), SSH_USERNAME);
});

test('generatePassword: 16 chars of a 32-symbol alphabet in 4 groups, no repeats', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const p = generatePassword();
    assert.match(p, /^[a-kmnp-z2-9]{4}(-[a-kmnp-z2-9]{4}){3}$/);
    seen.add(p);
  }
  assert.equal(seen.size, 200);
});

test('hashPassword: sha512-crypt that openssl verifies with the same salt', async () => {
  const h = await hashPassword('abcd-efgh-ijkm-npqr');
  assert.match(h, SHA512_CRYPT);
  const salt = h.split('$')[2];
  const again = execFileSync('openssl', ['passwd', '-6', '-salt', salt, '-stdin'], { input: 'abcd-efgh-ijkm-npqr', encoding: 'utf8' }).trim();
  assert.equal(again, h);
  assert.notEqual(await hashPassword('abcd-efgh-ijkm-npqr'), h); // random salt
});
