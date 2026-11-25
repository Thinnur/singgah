import { generateKeyPairSync } from 'node:crypto';

export function generateKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('x25519');
  // DER of x25519 keys ends with the 32 raw key bytes.
  const raw = (k: Buffer) => k.subarray(k.length - 32).toString('base64');
  return {
    privateKey: raw(privateKey.export({ type: 'pkcs8', format: 'der' })),
    publicKey: raw(publicKey.export({ type: 'spki', format: 'der' })),
  };
}

export function clientConfig(p: { privateKey: string; address: string; serverPubkey: string; endpoint: string; labCidr: string }): string {
  return [
    '[Interface]',
    `PrivateKey = ${p.privateKey}`,
    `Address = ${p.address}/32`,
    'MTU = 1200',
    'DNS = 10.8.0.1',
    '',
    '[Peer]',
    `PublicKey = ${p.serverPubkey}`,
    `Endpoint = ${p.endpoint}`,
    `AllowedIPs = 10.8.0.1/32, ${p.labCidr}`,
    'PersistentKeepalive = 25',
    '',
  ].join('\n');
}

/** WireGuard public key format: 32 bytes, base64 (44 chars, one '=' pad). */
export const isWgPubkey = (k: string): boolean => /^[A-Za-z0-9+/]{43}=$/.test(k);
