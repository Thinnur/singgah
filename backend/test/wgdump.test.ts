import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWgDump } from '../src/worker/wgdump.ts';

test('parseWgDump skips the interface line and returns numeric rx/tx per peer', () => {
  const dump = [
    'SERVERPRIVATE=\tSERVERPUB=\t51820\toff',
    'PUB1=\t(none)\t100.68.122.86:41000\t10.8.0.2/32\t1731400000\t100\t200\t25',
    'PUB2=\t(none)\t(none)\t(none)\t0\t0\t0\toff',
    'PUB3=\t(none)\t(none)\t10.8.0.3/32,10.8.0.4/32\t0\t5\t6\toff',
  ].join('\n') + '\n';
  assert.deepEqual(parseWgDump(dump), [
    { publicKey: 'PUB1=', allowedIps: ['10.8.0.2/32'], rx: 100, tx: 200 },
    { publicKey: 'PUB2=', allowedIps: [], rx: 0, tx: 0 },
    { publicKey: 'PUB3=', allowedIps: ['10.8.0.3/32', '10.8.0.4/32'], rx: 5, tx: 6 },
  ]);
});

test('parseWgDump on an interface without peers returns []', () => {
  assert.deepEqual(parseWgDump('SERVERPRIVATE=\tSERVERPUB=\t51820\toff\n'), []);
});
