// Self-test CLI, run on the gateway laptop as the singgah user, never root (root would own the SQLite
// -wal/-shm files and lock the services out), with /etc/singgah/singgah.env loaded; see README.
//   node src/cli/lease.ts add --email <e> --lab <id> --pubkey <p> --minutes <n>   -> "<leaseId> <tunnelIp>"
//   node src/cli/lease.ts revoke --id <n> --reason <r>
//   node src/cli/lease.ts ssh-grant --email <e> --lab <id> --password <p>   -> "<accountId> <username>" (APPROVED + hash)
//   node src/cli/lease.ts ssh-revoke --id <n> --reason <r>
// --password sits in argv: only for s5-selftest's throwaway password, never a real one.
// Skips the domain/quota policy on purpose; allocation and audit are the API's own (leasestore.ts).
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.ts';
import { openDb } from '../db.ts';
import { createLease, revokeLease } from '../leasestore.ts';
import { normalizeEmail } from '../rules.ts';
import { hashPassword } from '../sshcred.ts';
import { decideSsh, requestSsh, revokeSsh, setSshPasswordHash } from '../sshstore.ts';
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
    options: { email: { type: 'string' }, lab: { type: 'string' }, pubkey: { type: 'string' }, minutes: { type: 'string' }, id: { type: 'string' }, reason: { type: 'string' }, password: { type: 'string' } },
  });
  const db = openDb(loadConfig(process.env).dbPath, { migrate: false });
  const now = Date.now();
  const upsertUser = (raw: string) => {
    const email = normalizeEmail(raw);
    return (db.prepare(
      `INSERT INTO users(email,name,role,created_at) VALUES(?,?,'student',?)
       ON CONFLICT(email) DO UPDATE SET email=excluded.email RETURNING id`,
    ).get(email, email, now) as { id: number }).id;
  };
  if (cmd === 'add') {
    const minutes = Number(v.minutes);
    if (!v.email || !v.lab || !v.pubkey || !Number.isInteger(minutes) || minutes <= 0) fail('pakai: add --email <e> --lab <id> --pubkey <p> --minutes <n>');
    if (!isWgPubkey(v.pubkey)) fail('pubkey bukan public key WireGuard (base64 44 karakter)');
    if (!db.prepare('SELECT 1 FROM labs WHERE id=?').get(v.lab)) fail(`lab tidak dikenal: ${v.lab}`);
    const userId = upsertUser(v.email);
    const l = createLease(db, { userId, labId: v.lab, minutes, clientPubkey: v.pubkey, requesterIp: null, actor: ACTOR, nowMs: now });
    console.log(`${l.id} ${l.tunnelIp}`);
  } else if (cmd === 'revoke') {
    const id = Number(v.id);
    if (!Number.isInteger(id) || !v.reason) fail('pakai: revoke --id <n> --reason <r>');
    revokeLease(db, { leaseId: id, by: ACTOR, reason: v.reason, nowMs: now });
  } else if (cmd === 'ssh-grant') {
    if (!v.email || !v.lab || !v.password) fail('pakai: ssh-grant --email <e> --lab <id> --password <p>');
    const userId = upsertUser(v.email);
    // a run killed before cleanup leaves an open account; replace it so the grant always succeeds
    const open = db.prepare("SELECT id, status FROM ssh_accounts WHERE user_id=? AND lab_id=? AND status IN ('PENDING','APPROVED')").get(userId, v.lab) as
      { id: number; status: string } | undefined;
    if (open?.status === 'PENDING') decideSsh(db, { id: open.id, approve: false, by: ACTOR, reason: 'selftest', nowMs: now });
    if (open?.status === 'APPROVED') revokeSsh(db, { id: open.id, by: ACTOR, reason: 'selftest', nowMs: now });
    const a = requestSsh(db, { userId, labId: v.lab, actor: ACTOR, nowMs: now });
    decideSsh(db, { id: a.id, approve: true, by: ACTOR, reason: null, nowMs: now });
    setSshPasswordHash(db, { id: a.id, hash: await hashPassword(v.password), actor: ACTOR, nowMs: now });
    console.log(`${a.id} ${a.username}`);
  } else if (cmd === 'ssh-revoke') {
    const id = Number(v.id);
    if (!Number.isInteger(id) || !v.reason) fail('pakai: ssh-revoke --id <n> --reason <r>');
    revokeSsh(db, { id, by: ACTOR, reason: v.reason, nowMs: now });
  } else {
    fail('perintah: add | revoke | ssh-grant | ssh-revoke');
  }
  db.close();
} catch (e) {
  fail((e as Error).message);
}
