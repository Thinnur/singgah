import { loadConfig } from '../config.ts';
import { assertSchema, openDb } from '../db.ts';
import { syncAccountFiles } from './accounts.ts';
import { reconcileOnce } from './reconcile.ts';
import { realSys } from './sys.ts';

const config = loadConfig(process.env);
const db = openDb(config.dbPath, { migrate: false });
try {
  assertSchema(db);
} catch (e) {
  // the API owns migrations; systemd restarts us (RestartSec=5) until it has run
  console.error(`singgah worker: ${(e as Error).message}`);
  process.exit(1);
}

const sys = realSys(config.wgInterface);
let stopping = false;
let wake = () => {};
const stop = () => { stopping = true; wake(); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
console.log(`singgah worker: ${config.wgInterface}, siklus tiap ${config.reconcileIntervalS} detik`);

while (!stopping) {
  const t0 = performance.now();
  try {
    const r = await reconcileOnce(db, sys, Date.now());
    const ms = Math.round(performance.now() - t0);
    const line = `siklus ${ms} ms: pasang ${r.installed}, lepas ${r.removed}, tutup ${r.closed}`;
    if (r.errors.length) console.error(`${line}, error ${r.errors.length}: ${r.errors.join(' | ')}`);
    else if (r.installed || r.removed || r.closed) console.log(line);
  } catch (e) {
    console.error(`siklus gagal setelah ${Math.round(performance.now() - t0)} ms: ${(e as Error).message}`);
  }
  try {
    const a = syncAccountFiles(db, config.labAccountsDir);
    if (a.written.length) console.log(`akun ssh ditulis: ${a.written.join(', ')}`);
    if (a.errors.length) console.error(`akun ssh, error ${a.errors.length}: ${a.errors.join(' | ')}`);
  } catch (e) {
    console.error(`akun ssh gagal: ${(e as Error).message}`);
  }
  // a signal during a cycle lets it finish; during the sleep it ends the sleep
  if (!stopping) await new Promise<void>((r) => { const t = setTimeout(r, config.reconcileIntervalS * 1000); wake = () => { clearTimeout(t); r(); }; });
}
db.close();
console.log('singgah worker: berhenti');
