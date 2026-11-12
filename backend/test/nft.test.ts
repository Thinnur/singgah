import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNftScript, labSetName, labsWithRule } from '../src/worker/nft.ts';

const cyber = { id: 'lab-cyber', target_cidr: '192.168.20.0/24' };
const cloud = { id: 'lab-cloud', target_cidr: '192.168.10.0/24' };

test('labSetName: lab-cyber -> lab_cyber', () => {
  assert.equal(labSetName('lab-cyber'), 'lab_cyber');
});

test('buildNftScript: set, flush, elements and insert rule when the rule is missing', () => {
  const s = buildNftScript([cyber], new Map([['lab-cyber', ['10.8.0.2']]]), new Set());
  assert.ok(s.includes('add set ip s5gw lab_cyber { type ipv4_addr; }'), s);
  assert.ok(s.includes('flush set ip s5gw lab_cyber'), s);
  assert.ok(s.includes('add element ip s5gw lab_cyber { 10.8.0.2 }'), s);
  assert.ok(s.includes('insert rule ip s5gw forward iifname "wg0" ip saddr @lab_cyber ip daddr 192.168.20.0/24 accept comment "singgah:lab-cyber"'), s);
  // flush must come before the elements are added, or the new elements are wiped
  assert.ok(s.indexOf('flush set ip s5gw lab_cyber') < s.indexOf('add element ip s5gw lab_cyber'));
});

test('buildNftScript: no insert rule when present; lab without leases is flushed but gets no elements', () => {
  const s = buildNftScript([cyber, cloud], new Map([['lab-cyber', ['10.8.0.2', '10.8.0.3']]]), new Set(['lab-cyber', 'lab-cloud']));
  assert.doesNotMatch(s, /insert rule/);
  assert.ok(s.includes('add element ip s5gw lab_cyber { 10.8.0.2, 10.8.0.3 }'), s);
  assert.ok(s.includes('flush set ip s5gw lab_cloud'), s);
  assert.doesNotMatch(s, /add element ip s5gw lab_cloud/);
});

test('labsWithRule: finds singgah:<lab> comments on forward-chain rules only', () => {
  const json = JSON.stringify({
    nftables: [
      { metainfo: { version: '1.0.9', json_schema_version: 1 } },
      { table: { family: 'ip', name: 's5gw', handle: 1 } },
      { chain: { family: 'ip', table: 's5gw', name: 'forward', handle: 1, type: 'filter', hook: 'forward', prio: 0, policy: 'accept' } },
      { set: { family: 'ip', name: 'lab_cyber', table: 's5gw', type: 'ipv4_addr', handle: 3, elem: ['10.8.0.2'] } },
      { rule: { family: 'ip', table: 's5gw', chain: 'forward', handle: 7, comment: 'singgah:lab-cyber', expr: [] } },
      { rule: { family: 'ip', table: 's5gw', chain: 'forward', handle: 8, expr: [{ drop: null }] } },
      { rule: { family: 'ip', table: 's5gw', chain: 'forward', handle: 9, comment: 'docker', expr: [] } },
      { rule: { family: 'ip', table: 's5gw', chain: 'input', handle: 10, comment: 'singgah:lab-cloud', expr: [] } },
    ],
  });
  assert.deepEqual(labsWithRule(json), new Set(['lab-cyber']));
});
