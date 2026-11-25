import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';

test('TEST_MODE=1 works without GOOGLE_*', () => {
  const c = loadConfig({ TEST_MODE: '1' });
  assert.equal(c.testMode, true);
  assert.equal(c.trustedProxyIp, '127.0.0.1');
  assert.equal(c.port, 8780);
});

test('TEST_MODE=0 without GOOGLE_CLIENT_ID throws naming the variable', () => {
  assert.throws(() => loadConfig({ TEST_MODE: '0', GOOGLE_CLIENT_SECRET: 's' }), /GOOGLE_CLIENT_ID/);
});

test('email lists are trimmed and lowercased', () => {
  const c = loadConfig({ TEST_MODE: '1', ADMIN_EMAILS: ' A@x.com, b@y.com ' });
  assert.deepEqual(c.adminEmails, ['a@x.com', 'b@y.com']);
  assert.deepEqual(c.extraAllowedEmails, []);
});
