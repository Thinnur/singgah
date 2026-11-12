import { useEffect, useState } from 'react';
import { api, errorText, type Stats } from '../api.ts';
import { formatBytes, formatMinutes } from '../lib/time.ts';
import { Alert, PageHead } from '../ui.tsx';

const rate = (bps: number | undefined) => (bps === undefined ? '—' : `${formatBytes(bps)}/s`);

export default function AdminStats() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    // wg0 throughput is the delta between two polls, so the first reading is "—".
    const load = () => api<Stats>('GET', '/api/admin/stats').then((s) => { setStats(s); setError(''); }, (e) => setError(errorText(e)));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const maxMinutes = Math.max(1, ...(stats?.perLab.map((l) => l.minutes) ?? []));

  return (
    <div>
      <PageHead title="Statistik">Diperbarui setiap 5 detik.</PageHead>
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {stats && (
        <div className="space-y-6">
          <dl className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
            <div className="bg-ink p-5 text-white">
              <dt className="text-sm text-white/70">Lease aktif</dt>
              <dd className="mt-1 text-4xl font-extrabold tabular-nums">{stats.activeLeases}</dd>
            </div>
            <div className="bg-white p-5">
              <dt className="text-sm text-muted">wg0 masuk (rx)</dt>
              <dd className="mt-1 text-2xl font-bold tabular-nums">{rate(stats.wg0?.rxBps)}</dd>
            </div>
            <div className="bg-white p-5">
              <dt className="text-sm text-muted">wg0 keluar (tx)</dt>
              <dd className="mt-1 text-2xl font-bold tabular-nums">{rate(stats.wg0?.txBps)}</dd>
            </div>
          </dl>

          <section className="panel p-5 sm:p-6">
            <h2 className="text-lg font-bold">Pemakaian per lab</h2>
            <p className="mt-1 text-sm text-muted">Jumlah lease aktif dan total durasi yang dipesan.</p>
            <ul className="mt-5 space-y-4">
              {stats.perLab.map((l) => (
                <li key={l.labId}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
                    <span className="font-semibold">{l.labName} <span className="font-normal text-muted">{l.labId}</span></span>
                    <span className="tabular-nums text-muted">{l.leases} lease, {formatMinutes(l.minutes)}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-mist" aria-hidden="true">
                    <div className="h-full rounded-full bg-ink" style={{ width: `${(l.minutes / maxMinutes) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
            {stats.perLab.length === 0 && <p className="text-sm text-muted">Belum ada lab.</p>}
          </section>
        </div>
      )}
    </div>
  );
}
