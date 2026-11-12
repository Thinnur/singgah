import { useCallback, useEffect, useState } from 'react';
import { api, errorText, type AdminLease } from '../api.ts';
import { formatBytes, formatDateTime, formatRemaining } from '../lib/time.ts';
import { Alert, ConfirmDialog, PageHead, useNow } from '../ui.tsx';

type Status = AdminLease['status'];
const TABS: [Status, string][] = [['ACTIVE', 'Aktif'], ['EXPIRED', 'Kedaluwarsa'], ['REVOKED', 'Dicabut']];

export default function AdminLeases() {
  const now = useNow();
  const [status, setStatus] = useState<Status>('ACTIVE');
  const [rows, setRows] = useState<AdminLease[] | null>(null);
  const [error, setError] = useState('');
  const [target, setTarget] = useState<AdminLease | null>(null);
  const [busy, setBusy] = useState(false);
  const [revokeError, setRevokeError] = useState('');

  const load = useCallback(() => {
    api<AdminLease[]>('GET', `/api/admin/leases?status=${status}`).then((r) => { setRows(r); setError(''); }, (e) => setError(errorText(e)));
  }, [status]);

  useEffect(() => {
    setRows(null);
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  const revoke = async (reason: string) => {
    if (!target) return;
    setBusy(true);
    setRevokeError('');
    try {
      await api('POST', `/api/admin/leases/${target.id}/revoke`, { reason });
      setTarget(null);
      load();
    } catch (e) {
      setRevokeError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHead title="Lease">Lease yang sedang berjalan dan riwayatnya. Data diperbarui otomatis.</PageHead>

      <div role="tablist" aria-label="Status lease" className="mb-4 inline-flex rounded-lg border border-line bg-white p-1">
        {TABS.map(([s, label]) => (
          <button
            key={s} type="button" role="tab" aria-selected={s === status} onClick={() => setStatus(s)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${s === status ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="mb-4"><Alert>{error}</Alert></div>}

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead className="border-b border-line bg-mist/60">
            <tr>
              <th className="th">Pemohon</th>
              <th className="th">Lab</th>
              <th className="th">IP tunnel</th>
              <th className="th">{status === 'ACTIVE' ? 'Sisa waktu' : 'Selesai'}</th>
              <th className="th text-right">Diunggah</th>
              <th className="th text-right">Diunduh</th>
              {status === 'ACTIVE' && <th className="th"><span className="sr-only">Aksi</span></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows?.map((l) => (
              <tr key={l.id}>
                <td className="td">
                  <span className="block font-medium">{l.email}</span>
                  {l.requesterIp && <span className="block text-xs text-muted">dari {l.requesterIp}</span>}
                </td>
                <td className="td">
                  <span className="block">{l.labName}</span>
                  <span className="block text-xs text-muted">{l.labId}</span>
                </td>
                <td className="td tabular-nums">{l.tunnelIp}</td>
                <td className="td tabular-nums">
                  {status === 'ACTIVE' ? (
                    <>
                      <span className="block font-semibold">{formatRemaining(l.expiresAt - now)}</span>
                      <span className={`block text-xs ${l.peerActive ? 'text-go' : 'text-wait'}`}>
                        {l.peerActive ? 'Terpasang di gateway' : 'Menunggu gateway…'}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="block">{formatDateTime(l.revokedAt ?? l.expiresAt)}</span>
                      {l.reason && <span className="block text-xs text-muted">{l.reason}</span>}
                    </>
                  )}
                </td>
                <td className="td text-right tabular-nums">{formatBytes(l.bytesRx)}</td>
                <td className="td text-right tabular-nums">{formatBytes(l.bytesTx)}</td>
                {status === 'ACTIVE' && (
                  <td className="td text-right">
                    <button
                      type="button" className="btn btn-ghost min-h-9 px-3 text-stop hover:bg-red-50"
                      onClick={() => { setRevokeError(''); setTarget(l); }}
                    >
                      Cabut
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {rows?.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-muted">
            {status === 'ACTIVE' ? 'Tidak ada lease aktif saat ini.' : 'Belum ada lease dengan status ini.'}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={!!target} title="Cabut lease?" confirmLabel="Cabut lease" reasonLabel="Alasan pencabutan"
        busy={busy} error={revokeError} onConfirm={revoke} onClose={() => setTarget(null)}
      >
        {target && <>Akses {target.email} ke {target.labName} ({target.tunnelIp}) langsung ditutup. Alasan dicatat di audit.</>}
      </ConfirmDialog>
    </div>
  );
}
