import { useCallback, useEffect, useState } from 'react';
import { api, errorText, type AdminSshAccount, type SshAuditEntry, type SshStatus } from '../api.ts';
import { formatDateTime } from '../lib/time.ts';
import { Alert, ConfirmDialog, PageHead } from '../ui.tsx';

type Tab = SshStatus | 'AUDIT';
const TABS: [Tab, string][] = [['PENDING', 'Menunggu'], ['APPROVED', 'Disetujui'], ['REJECTED', 'Ditolak'], ['REVOKED', 'Dicabut'], ['AUDIT', 'Riwayat']];
const ACTION: Record<SshAuditEntry['action'], string> = {
  REQUESTED: 'Diajukan', APPROVED: 'Disetujui', REJECTED: 'Ditolak', REVOKED: 'Dicabut', PASSWORD_SET: 'Password dibuat',
};
const EMPTY: Record<SshStatus, string> = {
  PENDING: 'Tidak ada pengajuan yang menunggu.', APPROVED: 'Belum ada akun yang disetujui.',
  REJECTED: 'Belum ada pengajuan yang ditolak.', REVOKED: 'Belum ada akun yang dicabut.',
};

export default function AdminSsh() {
  const [tab, setTab] = useState<Tab>('PENDING');
  const [rows, setRows] = useState<AdminSshAccount[] | null>(null);
  const [audit, setAudit] = useState<SshAuditEntry[] | null>(null);
  const [error, setError] = useState('');
  const [approving, setApproving] = useState<number | null>(null);
  const [target, setTarget] = useState<{ row: AdminSshAccount; kind: 'reject' | 'revoke' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dlgError, setDlgError] = useState('');

  const load = useCallback(() => {
    const fail = (e: unknown) => setError(errorText(e));
    if (tab === 'AUDIT') api<SshAuditEntry[]>('GET', '/api/admin/ssh/audit').then((r) => { setAudit(r); setError(''); }, fail);
    else api<AdminSshAccount[]>('GET', `/api/admin/ssh?status=${tab}`).then((r) => { setRows(r); setError(''); }, fail);
  }, [tab]);

  useEffect(() => {
    setRows(null);
    setAudit(null);
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  const approve = async (r: AdminSshAccount) => {
    setApproving(r.id);
    setError('');
    try { await api('POST', `/api/admin/ssh/${r.id}/approve`); load(); } catch (e) { setError(errorText(e)); } finally { setApproving(null); }
  };
  const decide = async (reason: string) => {
    if (!target) return;
    setBusy(true);
    setDlgError('');
    try {
      await api('POST', `/api/admin/ssh/${target.row.id}/${target.kind}`, { reason });
      setTarget(null);
      load();
    } catch (e) {
      setDlgError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHead title="Akun SSH">Pengajuan akun SSH ke container lab. Akun baru bisa dipakai setelah disetujui.</PageHead>

      <div role="tablist" aria-label="Status akun SSH" className="mb-4 inline-flex max-w-full overflow-x-auto rounded-lg border border-line bg-white p-1">
        {TABS.map(([s, label]) => (
          <button
            key={s} type="button" role="tab" aria-selected={s === tab} onClick={() => setTab(s)}
            className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-semibold ${s === tab ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="mb-4"><Alert>{error}</Alert></div>}

      {tab === 'AUDIT' ? (
        <div className="panel overflow-x-auto">
          <table className="rtable md:min-w-[720px]">
            <thead className="border-b border-line bg-mist/60">
              <tr><th className="th">Waktu</th><th className="th">Aksi</th><th className="th">Akun</th><th className="th">Pelaku</th><th className="th">Alasan</th></tr>
            </thead>
            <tbody>
              {audit?.map((e) => (
                <tr key={e.id}>
                  <td data-label="Waktu" className="tabular-nums">{formatDateTime(e.at)}</td>
                  <td data-label="Aksi" className="font-medium">{ACTION[e.action]}</td>
                  <td data-label="Akun">
                    <span className="block">{String(e.detail.username ?? '')} · {String(e.detail.labId ?? '')}</span>
                    <span className="block text-xs text-muted">{String(e.detail.email ?? '')}</span>
                  </td>
                  <td data-label="Pelaku">{e.actor}</td>
                  <td data-label="Alasan" className="text-muted">{String(e.detail.reason ?? '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {audit?.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted">Belum ada riwayat.</p>}
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="rtable md:min-w-[720px]">
            <thead className="border-b border-line bg-mist/60">
              <tr>
                <th className="th">Pemohon</th>
                <th className="th">Lab</th>
                <th className="th">{tab === 'PENDING' ? 'Diajukan' : 'Diputuskan'}</th>
                {tab === 'APPROVED' && <th className="th">Password</th>}
                {(tab === 'PENDING' || tab === 'APPROVED') && <th className="th"><span className="sr-only">Aksi</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows?.map((r) => (
                <tr key={r.id}>
                  <td className="max-md:col-span-2">
                    <span className="block font-medium">{r.email}</span>
                    <span className="block text-xs text-muted">username {r.username}</span>
                  </td>
                  <td className="max-md:col-span-2">
                    <span className="block">{r.labName}</span>
                    <span className="block text-xs text-muted">{r.labId}</span>
                  </td>
                  <td data-label={tab === 'PENDING' ? 'Diajukan' : 'Diputuskan'} className="tabular-nums">
                    {tab === 'PENDING' ? formatDateTime(r.requestedAt) : (
                      <>
                        <span className="block">{r.decidedAt ? formatDateTime(r.decidedAt) : '-'}</span>
                        {r.decidedBy && <span className="block text-xs text-muted">oleh {r.decidedBy}</span>}
                        {r.reason && <span className="block text-xs text-muted">{r.reason}</span>}
                      </>
                    )}
                  </td>
                  {tab === 'APPROVED' && <td data-label="Password">{r.passwordSet ? 'Sudah dibuat' : 'Belum dibuat'}</td>}
                  {tab === 'PENDING' && (
                    <td className="max-md:col-span-2 md:text-right">
                      <div className="flex gap-2 md:justify-end">
                        <button type="button" className="btn btn-primary min-h-9 flex-1 px-3 md:flex-none" disabled={approving === r.id} onClick={() => approve(r)}>
                          {approving === r.id ? 'Memproses…' : 'Setujui'}
                        </button>
                        <button
                          type="button" className="btn btn-ghost min-h-9 flex-1 px-3 text-stop hover:bg-red-50 md:flex-none"
                          onClick={() => { setDlgError(''); setTarget({ row: r, kind: 'reject' }); }}
                        >
                          Tolak
                        </button>
                      </div>
                    </td>
                  )}
                  {tab === 'APPROVED' && (
                    <td className="max-md:col-span-2 md:text-right">
                      <button
                        type="button" className="btn btn-ghost min-h-9 w-full px-3 text-stop hover:bg-red-50 md:w-auto"
                        onClick={() => { setDlgError(''); setTarget({ row: r, kind: 'revoke' }); }}
                      >
                        Cabut
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {rows?.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted">{EMPTY[tab]}</p>}
        </div>
      )}

      <ConfirmDialog
        open={!!target}
        title={target?.kind === 'reject' ? 'Tolak pengajuan SSH?' : 'Cabut akun SSH?'}
        confirmLabel={target?.kind === 'reject' ? 'Tolak' : 'Cabut akun'}
        reasonLabel={target?.kind === 'reject' ? 'Alasan penolakan' : 'Alasan pencabutan'}
        busy={busy} error={dlgError} onConfirm={decide} onClose={() => setTarget(null)}
      >
        {target && (target.kind === 'reject'
          ? <>Pengajuan {target.row.email} untuk {target.row.labName} ditolak. Alasannya ditampilkan ke pemohon.</>
          : <>Akun {target.row.username} di {target.row.labName} langsung tidak bisa dipakai dan sesi yang berjalan diputus. Alasannya ditampilkan ke pemilik akun.</>)}
      </ConfirmDialog>
    </div>
  );
}
