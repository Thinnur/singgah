import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { labsWithRule } from '../src/worker/nft.ts';

const has = (cmd: string, arg: string) => spawnSync(cmd, [arg], { stdio: 'ignore' }).status === 0;
const url = (p: string) => new URL(p, import.meta.url).href;

// Runs inside `unshare --net`: a throwaway network namespace, so the host firewall is never touched.
const HELPER = `
import { execFileSync } from 'node:child_process';
import { realSys } from ${JSON.stringify(url('../src/worker/sys.ts'))};
import { buildNftScript, labsWithRule } from ${JSON.stringify(url('../src/worker/nft.ts'))};
// a fresh netns has an empty ruleset; anything else means we are not isolated
if (execFileSync('nft', ['list', 'ruleset'], { encoding: 'utf8' }).trim() !== '') throw new Error('ruleset tidak kosong, bukan netns baru');
execFileSync('nft', ['add table ip s5gw; add chain ip s5gw forward { type filter hook forward priority 0; policy accept; }; add rule ip s5gw forward iifname "wg0" drop']);
const sys = realSys('wg0');
const labs = [{ id: 'lab-cyber', target_cidr: '192.168.20.0/24' }];
await sys.nftApply(buildNftScript(labs, new Map([['lab-cyber', ['10.8.0.2', '10.8.0.3']]]), labsWithRule(await sys.nftListJson())));
const first = await sys.nftListJson();
await sys.nftApply(buildNftScript(labs, new Map([['lab-cyber', ['10.8.0.4']]]), labsWithRule(first)));
const second = await sys.nftListJson();
// a bad last line must roll back the whole script (flush included)
let rejected = false;
try { await sys.nftApply(buildNftScript(labs, new Map([['lab-cyber', ['10.8.0.9']]]), new Set(['lab-cyber'])) + 'add element ip s5gw nope { 10.8.0.9 }\\n'); } catch { rejected = true; }
const third = await sys.nftListJson();
console.log(JSON.stringify({ first, second, third, rejected }));
`;

type Item = { set?: { name: string; elem?: string[] }; rule?: { chain: string; comment?: string; expr: unknown[] } };
const items = (json: string) => (JSON.parse(json) as { nftables: Item[] }).nftables;
const elems = (json: string) => items(json).find((i) => i.set?.name === 'lab_cyber')?.set?.elem ?? [];
const forwardRules = (json: string) => items(json).flatMap((i) => (i.rule?.chain === 'forward' ? [i.rule] : []));

test('realSys.nftApply/nftListJson against real nftables in a throwaway netns', (t) => {
  if (process.getuid?.() !== 0 || !has('nft', '--version') || !has('unshare', '--version')) {
    t.skip('butuh root, nft, dan unshare');
    return;
  }
  const r = spawnSync('unshare', ['--net', '--', process.execPath, '--input-type=module', '-e', HELPER], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(r.status, 0, r.stderr);
  const { first, second, third, rejected } = JSON.parse(r.stdout) as { first: string; second: string; third: string; rejected: boolean };

  assert.deepEqual(labsWithRule(first), new Set(['lab-cyber']));
  assert.deepEqual(elems(first).sort(), ['10.8.0.2', '10.8.0.3']);
  // accept rule inserted ahead of the base drop
  assert.deepEqual(forwardRules(first).map((x) => x.comment ?? 'drop'), ['singgah:lab-cyber', 'drop']);

  // second apply: flush + add replaces the elements, the rule is not duplicated
  assert.deepEqual(elems(second), ['10.8.0.4']);
  assert.deepEqual(forwardRules(second).map((x) => x.comment ?? 'drop'), ['singgah:lab-cyber', 'drop']);

  // atomic: the failed script left the set exactly as it was
  assert.equal(rejected, true);
  assert.deepEqual(elems(third), ['10.8.0.4']);
});
