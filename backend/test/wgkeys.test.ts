import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { generateKeyPair, clientConfig } from '../src/wgkeys.ts';

const hasWg = (() => { try { execFileSync('which', ['wg'], { stdio: 'ignore' }); return true; } catch { return false; } })();

function pubFromPriv(priv: string): string {
  const der = Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), Buffer.from(priv, 'base64')]);
  const pub = createPublicKey(createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }));
  return pub.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
}

test('public key matches private key', () => {
  const { privateKey, publicKey } = generateKeyPair();
  assert.equal(Buffer.from(privateKey, 'base64').length, 32);
  assert.equal(pubFromPriv(privateKey), publicKey);
});

test('matches wg pubkey', { skip: !hasWg && 'wg tidak terpasang' }, () => {
  const { privateKey, publicKey } = generateKeyPair();
  assert.equal(execFileSync('wg', ['pubkey'], { input: privateKey }).toString().trim(), publicKey);
});

test('clientConfig', () => {
  assert.equal(
    clientConfig({ privateKey: 'PRIV', address: '10.8.0.5', serverPubkey: 'SRV', endpoint: '1.2.3.4:51820', labCidr: '192.168.20.0/24' }),
    '[Interface]\nPrivateKey = PRIV\nAddress = 10.8.0.5/32\nMTU = 1200\n\n[Peer]\nPublicKey = SRV\nEndpoint = 1.2.3.4:51820\nAllowedIPs = 10.8.0.1/32, 192.168.20.0/24\nPersistentKeepalive = 25\n',
  );
});
