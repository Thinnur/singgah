import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEmail, isEmailAllowed, allowedDurations, wibDayStart, nextWibMidnight, usedMinutesToday,
  checkLeaseRequest, allocateIp, parseCidr, cidrOverlaps, POOL_FULL,
} from '../src/rules.ts';

test('email', () => {
  assert.equal(normalizeEmail(' User@Mail.UGM.ac.id '), 'user@mail.ugm.ac.id');
  assert.ok(isEmailAllowed(' User@Mail.UGM.ac.id ', []));
  assert.ok(isEmailAllowed('a@ugm.ac.id', []));
  for (const e of ['a@mail.ugm.ac.id.evil.com', 'a@fakeugm.ac.id', 'a@gmail.com']) assert.ok(!isEmailAllowed(e, []));
  assert.ok(isEmailAllowed('a@gmail.com', ['a@gmail.com']));
});

test('durations', () => {
  assert.deepEqual(allowedDurations(4, false), [60, 120, 240]);
  assert.deepEqual(allowedDurations(2, false), [60, 120]);
  assert.deepEqual(allowedDurations(4, true), [1, 60, 120, 240]);
});

const wib = (d: number, h: number, m = 0) => Date.UTC(2026, 10, d, h - 7, m);

test('quota in WIB', () => {
  assert.equal(nextWibMidnight(Date.UTC(2026, 10, 12, 10, 0)), Date.UTC(2026, 10, 12, 17, 0));
  assert.equal(wibDayStart(Date.UTC(2026, 10, 12, 10, 0)), Date.UTC(2026, 10, 11, 17, 0));
  const night = { starts_at: wib(12, 23), expires_at: wib(13, 1), revoked_at: null };
  assert.equal(usedMinutesToday([night], wib(13, 0, 30)), 0);
  assert.equal(usedMinutesToday([night], wib(12, 23, 30)), 30);
  const early = { starts_at: wib(12, 10), expires_at: wib(12, 12), revoked_at: wib(12, 10, 30) };
  assert.equal(usedMinutesToday([early], wib(12, 15)), 30);
});

const base = { lab: { is_active: 1, max_hours: 4 }, minutes: 60, hasActive: false, usedMinutes: 0, quotaHours: 8, testMode: false, nowMs: 0 };
test('checkLeaseRequest', () => {
  assert.equal(checkLeaseRequest(base), null);
  assert.deepEqual(checkLeaseRequest({ ...base, lab: undefined }), { code: 'LAB_UNAVAILABLE', message: 'Lab sedang tidak tersedia', status: 404 });
  assert.equal(checkLeaseRequest({ ...base, lab: { is_active: 0, max_hours: 4 }, hasActive: true })?.code, 'LAB_UNAVAILABLE');
  assert.equal(checkLeaseRequest({ ...base, minutes: 90 })?.status, 400);
  assert.equal(checkLeaseRequest({ ...base, minutes: 240, lab: { is_active: 1, max_hours: 2 } })?.code, 'BAD_DURATION');
  assert.equal(checkLeaseRequest({ ...base, minutes: 1 })?.code, 'BAD_DURATION');
  assert.equal(checkLeaseRequest({ ...base, minutes: 1, testMode: true }), null);
  assert.equal(checkLeaseRequest({ ...base, hasActive: true, usedMinutes: 9999 })?.code, 'HAS_ACTIVE');
  assert.equal(checkLeaseRequest({ ...base, hasActive: true })?.status, 409);
  const q = checkLeaseRequest({ ...base, usedMinutes: 450 });
  assert.equal(q?.code, 'QUOTA');
  assert.equal(q?.status, 429);
  assert.match(q!.message, /30 menit/);
  assert.match(q!.message, /pulih pukul 00\.00 WIB/);
  assert.equal(checkLeaseRequest({ ...base, usedMinutes: 420 }), null);
  assert.deepEqual([POOL_FULL.code, POOL_FULL.status, POOL_FULL.message], ['POOL_FULL', 503, 'Kapasitas sedang penuh, coba lagi nanti']);
});

test('allocateIp', () => {
  assert.equal(allocateIp(new Set()), '10.8.0.2');
  assert.equal(allocateIp(new Set(['10.8.0.2', '10.8.0.3'])), '10.8.0.4');
  assert.equal(allocateIp(new Set(Array.from({ length: 253 }, (_, i) => `10.8.0.${i + 2}`))), null);
});

test('cidr', () => {
  assert.ok(cidrOverlaps('192.168.20.0/24', '192.168.20.128/25'));
  assert.ok(!cidrOverlaps('192.168.20.0/24', '192.168.21.0/24'));
  assert.ok(cidrOverlaps('172.20.0.0/16', '172.16.0.0/12'));
  assert.throws(() => parseCidr('192.168.20.5/24'));
  assert.throws(() => parseCidr('300.1.1.0/24'));
  assert.throws(() => parseCidr('10.0.0.0/33'));
  assert.throws(() => parseCidr('abc'));
});
