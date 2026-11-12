// Self-test CLI, run on the gateway laptop as the singgah user, never root (root would own the SQLite
// -wal/-shm files and lock the services out), with /etc/singgah/singgah.env loaded; see README.
//   node src/cli/lease.ts add --email <e> --lab <id> --pubkey <p> --minutes <n>   -> "<leaseId> <tunnelIp>"
//   node src/cli/lease.ts revoke --id <n> --reason <r>
// Skips the domain/quota policy on purpose; allocation and audit are the API's own (leasestore.ts).
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.ts';
import { openDb } from '../db.ts';
import { createLease, revokeLease } from '../leasestore.ts';
import { normalizeEmail } from '../rules.ts';
import { isWgPubkey } from '../wgkeys.ts';

const ACTOR = 'selftest';
const [cmd, ...rest] = process.argv.slice(2);

function fail(m: string): never {
  console.error(`lease: ${m}`);
  process.exit(1);
}

try {
  const { values: v } = parseArgs({
    args: rest,
    options: { email: { type: 'string' }, lab: { type: 'string' }, pubkey: { type: 'string' }, minutes: { type: 'string' }, id: { type: 'string' }, reason: { type: 'string' } },
  });
  const db = openDb(loadConfig(process.env).dbPath, { migrate: false });
  const now = Date.now();
  if (cmd === 'add') {
    const minutes = Number(v.minutes);
    if (!v.email || !v.lab || !v.pubkey || !Number.isInteger(minutes) || minutes <= 0) fail('pakai: add --email <e> --lab <id> --pubkey <p> --minutes <n>');
    if (!isWgPubkey(v.pubkey)) fail('pubkey bukan public key WireGuard (base64 44 karakter)');
    if (!db.prepare('SELECT 1 FROM labs WHERE id=?').get(v.lab)) fail(`lab tidak dikenal: ${v.lab}`);
    const email = normalizeEmail(v.email);
    const { id: userId } = db.prepare(
      `INSERT INTO users(email,name,role,created_at) VALUES(?,?,'student',?)
       ON CONFLICT(email) DO UPDATE SET email=excluded.email RETURNING id`,
    ).get(email, email, now) as { id: number };
    const l = createLease(db, { userId, labId: v.lab, minutes, clientPubkey: v.pubkey, requesterIp: null, actor: ACTOR, nowMs: now });
    console.log(`${l.id} ${l.tunnelIp}`);
  } else if (cmd === 'revoke') {
    const id = Number(v.id);
    if (!Number.isInteger(id) || !v.reason) fail('pakai: revoke --id <n> --reason <r>');
    revokeLease(db, { leaseId: id, by: ACTOR, reason: v.reason, nowMs: now });
  } else {
    fail('perintah: add | revoke');
  }
  db.close();
} catch (e) {
  fail((e as Error).message);
}
