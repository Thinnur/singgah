import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.ts';
import { createLease, revokeLease } from '../src/leasestore.ts';
import { reconcileOnce } from '../src/worker/reconcile.ts';
import type { Sys } from '../src/worker/sys.ts';

const T0 = 1_000_000;
const key = (n: number) => Buffer.alloc(32, n).toString('base64');

/** In-memory wg0 + s5gw that records every call in order. */
function fakeSys() {
  const calls: string[] = [];
  const peers = new Map<string, { ip: string; rx: number; tx: number }>();
  const rules = new Set<string>();
  const scripts: string[] = [];
  const fail = { dump: false, list: false, apply: false, set: new Set<string>(), remove: new Set<string>() };
  const sys: Sys = {
    async wgDump() {
      calls.push('dump');
      if (fail.dump) throw new Error('Unable to access interface: No such device');
      const lines = [...peers].map(([k, p]) => [k, '(none)', '(none)', `${p.ip}/32`, '0', p.rx, p.tx, 'off'].join('\t'));
      return ['SERVERPRIVATE=\tSERVERPUB=\t51820\toff', ...lines].join('\n') + '\n';
    },
    async wgSetPeer(pub, ip) {
      calls.push(`set ${pub} ${ip}`);
      if (fail.set.has(pub)) throw new Error('wg set gagal');
      peers.set(pub, { rx: 0, tx: 0, ...peers.get(pub), ip });
    },
    async wgRemovePeer(pub) {
      calls.push(`remove ${pub}`);
      if (fail.remove.has(pub)) throw new Error('wg remove gagal');
      peers.delete(pub);
    },
    async nftListJson() {
      calls.push('nft list');
      if (fail.list) throw new Error('Error: No such file or directory; list table ip s5gw');
      return JSON.stringify({
        nftables: [
          { metainfo: { json_schema_version: 1 } },
          { table: { family: 'ip', name: 's5gw', handle: 1 } },
          ...[...rules].map((id, i) => ({ rule: { family: 'ip', table: 's5gw', chain: 'forward', handle: 10 + i, comment: `singgah:${id}`, expr: [] } })),
        ],
      });
    },
    async nftApply(script) {
      calls.push('nft apply');
      if (fail.apply) throw new Error('nft apply gagal');
      scripts.push(script);
      for (const m of script.matchAll(/comment "singgah:(lab-[a-z0-9]+)"/g)) rules.add(m[1]);
    },
  };
  return { sys, calls, peers, scripts, fail };
}

type LeaseRow = { status: string; installed_at: number | null; ended_at: number | null; bytes_rx: number; bytes_tx: number; wg_rx_seen: number; wg_tx_seen: number };

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'singgah-'));
  const db = openDb(join(dir, 't.db'));
  let n = 0;
  const lease = (nowMs = T0) => {
    n++;
    const { id: userId } = db.prepare("INSERT INTO users(email,name,role,created_at) VALUES(?,?,'student',0) RETURNING id").get(`u${n}@ugm.ac.id`, `u${n}`) as { id: number };
    const pub = key(n);
    return { ...createLease(db, { userId, labId: 'lab-cyber', minutes: 60, clientPubkey: pub, requesterIp: null, actor: 'x', nowMs }), pub, email: `u${n}@ugm.ac.id` };
  };
  const row = (id: number) => ({ ...db.prepare('SELECT * FROM leases WHERE id=?').get(id) }) as LeaseRow;
  const audits = (action: string) =>
    (db.prepare('SELECT lease_id, actor, at, detail FROM audit_log WHERE action=? ORDER BY id').all(action) as { lease_id: number; actor: string; at: number; detail: string }[])
      .map((a) => ({ ...a, detail: JSON.parse(a.detail) }));
  const snapshot = () => JSON.stringify(['users', 'labs', 'leases', 'audit_log', 'sessions'].map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()));
  return { db, lease, row, audits, snapshot, done: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('new ACTIVE lease: peer installed with its tunnel IP, installed_at set, nft element added; next cycle is a no-op', async () => {
  const t = setup();
  const f = fakeSys();
  const a = t.lease();
  const r = await reconcileOnce(t.db, f.sys, T0 + 1000);
  assert.deepEqual(r, { installed: 1, removed: 0, closed: 0, errors: [] });
  assert.ok(f.calls.includes(`set ${a.pub} 10.8.0.2`), f.calls.join('\n'));
  assert.equal(t.row(a.id).installed_at, T0 + 1000);
  assert.ok(f.scripts[0].includes('add element ip s5gw lab_cyber { 10.8.0.2 }'), f.scripts[0]);
  assert.ok(f.scripts[0].includes('comment "singgah:lab-cyber"'));

  f.calls.length = 0;
  const r2 = await reconcileOnce(t.db, f.sys, T0 + 2000);
  assert.deepEqual(r2, { installed: 0, removed: 0, closed: 0, errors: [] });
  assert.deepEqual(f.calls, ['dump', 'nft list', 'nft apply']);
  assert.doesNotMatch(f.scripts[1], /insert rule/);
  assert.equal(t.row(a.id).installed_at, T0 + 1000);
  t.done();
});

test('expired lease: bytes saved before wgRemovePeer, status EXPIRED, ended_at, EXPIRED audit with bytes', async () => {
  const t = setup();
  const f = fakeSys();
  const a = t.lease();
  await reconcileOnce(t.db, f.sys, T0);
  Object.assign(f.peers.get(a.pub)!, { rx: 100, tx: 200 });
  let atRemove: LeaseRow | undefined;
  const remove = f.sys.wgRemovePeer;
  f.sys.wgRemovePeer = async (pub) => { atRemove = t.row(a.id); return remove(pub); };

  const now = a.expiresAt + 1;
  const r = await reconcileOnce(t.db, f.sys, now);
  assert.deepEqual(r, { installed: 0, removed: 1, closed: 1, errors: [] });
  assert.equal(atRemove?.bytes_rx, 100);
  assert.equal(atRemove?.bytes_tx, 200);
  assert.equal(f.peers.size, 0);
  const l = t.row(a.id);
  assert.equal(l.status, 'EXPIRED');
  assert.equal(l.ended_at, now);
  assert.deepEqual(t.audits('EXPIRED'), [{
    lease_id: a.id, actor: 'worker', at: now,
    detail: { email: a.email, tunnelIp: '10.8.0.2', labId: 'lab-cyber', minutes: 60, startsAt: a.startsAt, expiresAt: a.expiresAt, bytesRx: 100, bytesTx: 200 },
  }]);
  assert.doesNotMatch(f.scripts.at(-1)!, /add element/);
  t.done();
});

test('REVOKED lease: peer removed, ended_at set, CLOSED audit with bytes, status stays REVOKED', async () => {
  const t = setup();
  const f = fakeSys();
  const a = t.lease();
  await reconcileOnce(t.db, f.sys, T0);
  Object.assign(f.peers.get(a.pub)!, { rx: 7, tx: 9 });
  revokeLease(t.db, { leaseId: a.id, by: 'admin@ugm.ac.id', reason: 'uji', nowMs: T0 + 5000 });

  const now = T0 + 6000;
  const r = await reconcileOnce(t.db, f.sys, now);
  assert.deepEqual(r, { installed: 0, removed: 1, closed: 1, errors: [] });
  assert.ok(f.calls.includes(`remove ${a.pub}`));
  const l = t.row(a.id);
  assert.equal(l.status, 'REVOKED');
  assert.equal(l.ended_at, now);
  assert.deepEqual(t.audits('CLOSED'), [{
    lease_id: a.id, actor: 'worker', at: now,
    detail: { email: a.email, tunnelIp: '10.8.0.2', labId: 'lab-cyber', minutes: 60, startsAt: a.startsAt, expiresAt: a.expiresAt, bytesRx: 7, bytesTx: 9 },
  }]);
  t.done();
});

test('orphan peer (no lease) is removed and the DB is untouched', async () => {
  const t = setup();
  const f = fakeSys();
  f.peers.set(key(99), { ip: '10.8.0.200', rx: 5, tx: 5 });
  const before = t.snapshot();
  const r = await reconcileOnce(t.db, f.sys, T0);
  assert.deepEqual(r, { installed: 0, removed: 1, closed: 0, errors: [] });
  assert.ok(f.calls.includes(`remove ${key(99)}`));
  assert.equal(t.snapshot(), before);
  t.done();
});

test('counter reset: seen=500 bytes=500, dump rx=50 -> bytes 550; then normal delta', async () => {
  const t = setup();
  const f = fakeSys();
  const a = t.lease();
  await reconcileOnce(t.db, f.sys, T0);
  t.db.prepare('UPDATE leases SET bytes_rx=500, bytes_tx=500, wg_rx_seen=500, wg_tx_seen=500 WHERE id=?').run(a.id);
  Object.assign(f.peers.get(a.pub)!, { rx: 50, tx: 60 });
  await reconcileOnce(t.db, f.sys, T0 + 1000);
  let l = t.row(a.id);
  assert.deepEqual([l.bytes_rx, l.bytes_tx, l.wg_rx_seen, l.wg_tx_seen], [550, 560, 50, 60]);

  Object.assign(f.peers.get(a.pub)!, { rx: 80, tx: 60 });
  await reconcileOnce(t.db, f.sys, T0 + 2000);
  l = t.row(a.id);
  assert.deepEqual([l.bytes_rx, l.bytes_tx, l.wg_rx_seen, l.wg_tx_seen], [580, 560, 80, 60]);
  t.done();
});

test('after reboot (wg0 empty): ACTIVE lease reinstalled, seen reset to 0, bytes kept', async () => {
  const t = setup();
  const f = fakeSys();
  const a = t.lease();
  await reconcileOnce(t.db, f.sys, T0);
  Object.assign(f.peers.get(a.pub)!, { rx: 100, tx: 100 });
  await reconcileOnce(t.db, f.sys, T0 + 1000);
  f.peers.clear();
  const r = await reconcileOnce(t.db, f.sys, T0 + 2000);
  assert.equal(r.installed, 1);
  let l = t.row(a.id);
  assert.deepEqual([l.bytes_rx, l.wg_rx_seen, l.installed_at], [100, 0, T0 + 2000]);
  Object.assign(f.peers.get(a.pub)!, { rx: 10, tx: 10 });
  await reconcileOnce(t.db, f.sys, T0 + 3000);
  l = t.row(a.id);
  assert.deepEqual([l.bytes_rx, l.bytes_tx], [110, 110]);
  t.done();
});

test('wgSetPeer fails for one lease: the other is still installed, one error, retried next cycle', async () => {
  const t = setup();
  const f = fakeSys();
  const a = t.lease();
  const b = t.lease();
  f.fail.set.add(a.pub);
  const r = await reconcileOnce(t.db, f.sys, T0);
  assert.equal(r.installed, 1);
  assert.equal(r.errors.length, 1);
  assert.ok(f.peers.has(b.pub));
  assert.equal(t.row(a.id).installed_at, null);

  f.fail.set.clear();
  f.calls.length = 0;
  const r2 = await reconcileOnce(t.db, f.sys, T0 + 1000);
  assert.deepEqual(r2, { installed: 1, removed: 0, closed: 0, errors: [] });
  assert.ok(f.calls.includes(`set ${a.pub} 10.8.0.2`));
  assert.equal(t.row(a.id).installed_at, T0 + 1000);
  t.done();
});

test('wg0 missing: wgDump throws -> error recorded, no DB row changes, nothing else touched', async () => {
  const t = setup();
  const f = fakeSys();
  const a = t.lease();
  const b = t.lease();
  revokeLease(t.db, { leaseId: b.id, by: 'admin@ugm.ac.id', reason: 'uji', nowMs: T0 + 1000 });
  const now = a.expiresAt + 1;
  t.lease(now); // a fresh ACTIVE lease that would otherwise be installed
  f.fail.dump = true;
  const before = t.snapshot();
  const r = await reconcileOnce(t.db, f.sys, now);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /No such device/);
  assert.deepEqual([r.installed, r.removed, r.closed], [0, 0, 0]);
  assert.equal(t.snapshot(), before);
  assert.deepEqual(f.calls, ['dump']);
  t.done();
});

for (const which of ['list', 'apply'] as const) {
  test(`s5gw missing (nft ${which} throws): unwanted peers still removed, no lease closed; closed next cycle`, async () => {
    const t = setup();
    const f = fakeSys();
    const a = t.lease();
    const b = t.lease();
    await reconcileOnce(t.db, f.sys, T0);
    revokeLease(t.db, { leaseId: b.id, by: 'admin@ugm.ac.id', reason: 'uji', nowMs: T0 + 1000 });
    f.fail[which] = true;
    const now = a.expiresAt + 1;
    const r = await reconcileOnce(t.db, f.sys, now);
    assert.deepEqual([r.removed, r.closed, r.errors.length], [2, 0, 1]);
    assert.equal(f.peers.size, 0);
    assert.deepEqual([t.row(a.id).status, t.row(a.id).ended_at], ['ACTIVE', null]);
    assert.deepEqual([t.row(b.id).status, t.row(b.id).ended_at], ['REVOKED', null]);
    assert.equal(t.audits('EXPIRED').length + t.audits('CLOSED').length, 0);

    f.fail[which] = false;
    const r2 = await reconcileOnce(t.db, f.sys, now + 1000);
    assert.deepEqual(r2, { installed: 0, removed: 0, closed: 2, errors: [] });
    assert.equal(t.row(a.id).status, 'EXPIRED');
    assert.equal(t.row(b.id).ended_at, now + 1000);
    t.done();
  });
}

test('nft sync fails: a new lease is NOT installed (s5gw may be missing = unfiltered), removals still happen; installed next cycle', async () => {
  const t = setup();
  const f = fakeSys();
  f.peers.set(key(99), { ip: '10.8.0.200', rx: 0, tx: 0 }); // orphan
  const a = t.lease();
  f.fail.apply = true;
  const r = await reconcileOnce(t.db, f.sys, T0);
  assert.deepEqual([r.installed, r.removed, r.errors.length], [0, 1, 1]);
  assert.ok(!f.calls.some((c) => c.startsWith('set ')), f.calls.join('\n'));
  assert.equal(t.row(a.id).installed_at, null);

  f.fail.apply = false;
  const r2 = await reconcileOnce(t.db, f.sys, T0 + 1000);
  assert.deepEqual(r2, { installed: 1, removed: 0, closed: 0, errors: [] });
  assert.equal(t.row(a.id).installed_at, T0 + 1000);
  t.done();
});

test('peer removal fails: lease not closed, retried next cycle', async () => {
  const t = setup();
  const f = fakeSys();
  const a = t.lease();
  await reconcileOnce(t.db, f.sys, T0);
  f.fail.remove.add(a.pub);
  const now = a.expiresAt + 1;
  const r = await reconcileOnce(t.db, f.sys, now);
  assert.deepEqual([r.removed, r.closed, r.errors.length], [0, 0, 1]);
  assert.deepEqual([t.row(a.id).status, t.row(a.id).ended_at], ['ACTIVE', null]);

  f.fail.remove.clear();
  const r2 = await reconcileOnce(t.db, f.sys, now + 1000);
  assert.deepEqual(r2, { installed: 0, removed: 1, closed: 1, errors: [] });
  assert.equal(t.row(a.id).status, 'EXPIRED');
  t.done();
});

test('REVOKED with no peer installed (after reboot): closed right away with the last saved bytes', async () => {
  const t = setup();
  const f = fakeSys();
  const a = t.lease();
  t.db.prepare('UPDATE leases SET bytes_rx=1234, bytes_tx=567 WHERE id=?').run(a.id);
  revokeLease(t.db, { leaseId: a.id, by: 'admin@ugm.ac.id', reason: 'uji', nowMs: T0 + 1000 });
  const r = await reconcileOnce(t.db, f.sys, T0 + 2000);
  assert.deepEqual(r, { installed: 0, removed: 0, closed: 1, errors: [] });
  assert.equal(t.row(a.id).ended_at, T0 + 2000);
  assert.deepEqual(t.audits('CLOSED').map((x) => x.detail), [{ email: a.email, tunnelIp: '10.8.0.2', labId: 'lab-cyber', minutes: 60, startsAt: a.startsAt, expiresAt: a.expiresAt, bytesRx: 1234, bytesTx: 567 }]);
  t.done();
});

test('tampered rows (bad lab id / tunnel IP) never reach wg or nft', async () => {
  const t = setup();
  const f = fakeSys();
  // the GLOB CHECK on labs.id lets this through; the API regex would not
  t.db.prepare(`INSERT INTO labs(id,name,target_cidr) VALUES('lab-x"; flush ruleset','x','10.0.0.0/8')`).run();
  // nft would read 012 as octal 10 (lab-cloud's subnet)
  t.db.prepare(`INSERT INTO labs(id,name,target_cidr) VALUES('lab-oct','x','192.168.012.0/24')`).run();
  const a = t.lease();
  t.db.prepare("UPDATE leases SET tunnel_ip='0.0.0.0/0' WHERE id=?").run(a.id);
  const r = await reconcileOnce(t.db, f.sys, T0);
  assert.equal(r.installed, 0);
  assert.equal(r.errors.length, 3);
  assert.ok(!f.calls.some((c) => c.startsWith('set ')));
  assert.doesNotMatch(f.scripts[0], /flush ruleset|0\.0\.0\.0|lab_oct|012/);
  t.done();
});
