import type { DatabaseSync } from 'node:sqlite';
import { tx } from '../leasestore.ts';
import { parseCidr } from '../rules.ts';
import { isWgPubkey } from '../wgkeys.ts';
import { buildNftScript, labsWithRule } from './nft.ts';
import type { Sys } from './sys.ts';
import { parseWgDump, type WgPeer } from './wgdump.ts';

type OpenLease = {
  id: number; lab_id: string; tunnel_ip: string; client_pubkey: string;
  status: string; expires_at: number; wg_rx_seen: number; wg_tx_seen: number;
};

const LAB_ID = /^lab-[a-z0-9]{1,20}$/;
const POOL_IP = /^10\.8\.0\.(25[0-4]|2[0-4]\d|1\d\d|[1-9]\d|[2-9])$/;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isCidr = (c: string) => { try { parseCidr(c); return true; } catch { return false; } };
// wg counters restart at 0 when a peer is re-added; then the whole current value is new traffic
const delta = (cur: number, seen: number) => (cur >= seen ? cur - seen : cur);

/** One reconcile cycle (design §7, steps 1–8): make wg0 and the s5gw lab sets match the ACTIVE leases. */
export async function reconcileOnce(db: DatabaseSync, sys: Sys, nowMs: number): Promise<{ installed: number; removed: number; closed: number; errors: string[] }> {
  const res = { installed: 0, removed: 0, closed: 0, errors: [] as string[] };

  // 1. Real state. Without the peer list nothing can be decided safely, so nothing is touched.
  let peers: WgPeer[];
  try { peers = parseWgDump(await sys.wgDump()); } catch (e) { res.errors.push(msg(e)); return res; }

  // 2. Desired state. "open" = every lease the worker has not finished cleaning up.
  const open = db.prepare(
    'SELECT id, lab_id, tunnel_ip, client_pubkey, status, expires_at, wg_rx_seen, wg_tx_seen FROM leases WHERE ended_at IS NULL',
  ).all() as OpenLease[];
  const desired = open.filter((l) => {
    if (l.status !== 'ACTIVE' || l.expires_at <= nowMs) return false;
    // the API runs without capabilities; a tampered row must not steer wg/nft
    if (isWgPubkey(l.client_pubkey) && POOL_IP.test(l.tunnel_ip)) return true;
    res.errors.push(`lease ${l.id}: pubkey/tunnel_ip tidak valid, dilewati`);
    return false;
  });
  const wanted = new Set(desired.map((l) => l.client_pubkey));

  // 3. Save bytes of every peer that has a lease, before anything is removed.
  const byPub = new Map(open.map((l) => [l.client_pubkey, l]));
  const counted = peers.flatMap((p) => {
    const l = byPub.get(p.publicKey);
    return l && (p.rx !== l.wg_rx_seen || p.tx !== l.wg_tx_seen) ? [{ l, p }] : [];
  });
  if (counted.length) {
    const save = db.prepare('UPDATE leases SET bytes_rx=bytes_rx+?, bytes_tx=bytes_tx+?, wg_rx_seen=?, wg_tx_seen=? WHERE id=?');
    tx(db, () => { for (const { l, p } of counted) save.run(delta(p.rx, l.wg_rx_seen), delta(p.tx, l.wg_tx_seen), p.rx, p.tx, l.id); });
  }

  // 4. Remove unwanted peers: expired, revoked, orphan.
  const present = new Set(peers.map((p) => p.publicKey));
  for (const p of peers) {
    if (wanted.has(p.publicKey)) continue;
    try {
      await sys.wgRemovePeer(p.publicKey);
      present.delete(p.publicKey);
      res.removed++;
    } catch (e) { res.errors.push(msg(e)); }
  }

  // 5. Lab sets and accept rules, one nft transaction.
  let nftOk = true;
  try {
    const labs = (db.prepare('SELECT id, target_cidr FROM labs ORDER BY id').all() as { id: string; target_cidr: string }[]).filter((l) => {
      if (LAB_ID.test(l.id) && isCidr(l.target_cidr)) return true;
      res.errors.push(`lab ${JSON.stringify(l.id)}: id/target_cidr tidak valid, dilewati`);
      return false;
    });
    const ips = new Map<string, string[]>();
    for (const l of desired) ips.set(l.lab_id, [...(ips.get(l.lab_id) ?? []), l.tunnel_ip]);
    await sys.nftApply(buildNftScript(labs, ips, labsWithRule(await sys.nftListJson())));
  } catch (e) {
    nftOk = false;
    res.errors.push(msg(e));
  }

  // 6. Install desired leases that are missing or have the wrong allowed-ips.
  const peerOf = new Map(peers.map((p) => [p.publicKey, p]));
  const markInstalled = db.prepare('UPDATE leases SET installed_at=?, wg_rx_seen=0, wg_tx_seen=0 WHERE id=?');
  for (const l of desired) {
    const peer = peerOf.get(l.client_pubkey);
    if (peer?.allowedIps.join() === `${l.tunnel_ip}/32`) continue;
    try {
      await sys.wgSetPeer(l.client_pubkey, l.tunnel_ip);
      if (!peer) markInstalled.run(nowMs, l.id); // a new peer's counters start at 0
      res.installed++;
    } catch (e) { res.errors.push(`lease ${l.id}: ${msg(e)}`); }
  }

  // 7. Close leases whose peer is gone. Not when nft failed: their set elements may still be there.
  if (!nftOk) return res;
  const close = db.prepare('UPDATE leases SET status=?, ended_at=? WHERE id=? AND status=? AND ended_at IS NULL');
  const info = db.prepare('SELECT l.bytes_rx, l.bytes_tx, u.email FROM leases l JOIN users u ON u.id=l.user_id WHERE l.id=?');
  const audit = db.prepare("INSERT INTO audit_log(lease_id,action,actor,at,detail) VALUES(?,?,'worker',?,?)");
  for (const l of open) {
    if (present.has(l.client_pubkey)) continue;
    const action = l.status === 'REVOKED' ? 'CLOSED' : l.status === 'ACTIVE' && l.expires_at <= nowMs ? 'EXPIRED' : null;
    if (!action) continue;
    try {
      const done = tx(db, () => {
        // 0 rows = the API changed the lease since step 2; next cycle sees the new state
        if (close.run(action === 'EXPIRED' ? 'EXPIRED' : 'REVOKED', nowMs, l.id, l.status).changes === 0) return false;
        const d = info.get(l.id) as { bytes_rx: number; bytes_tx: number; email: string };
        audit.run(l.id, action, nowMs, JSON.stringify({ email: d.email, tunnelIp: l.tunnel_ip, labId: l.lab_id, bytesRx: d.bytes_rx, bytesTx: d.bytes_tx }));
        return true;
      });
      if (done) res.closed++;
    } catch (e) { res.errors.push(`tutup lease ${l.id}: ${msg(e)}`); }
  }
  return res;
}
