import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText, type SshLabView, type SshPasswordResponse } from '../api.ts';
import { formatDateTime } from '../lib/time.ts';
import { Alert } from '../ui.tsx';

/** Shown on `/` under the lease: request an SSH account per lab, then make a one-time password once approved. */
export default function SshAccounts() {
  const [labs, setLabs] = useState<SshLabView[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [shown, setShown] = useState<SshPasswordResponse | null>(null);

  const load = useCallback(
    () => api<SshLabView[]>('GET', '/api/ssh').then((l) => { setLabs(l); setError(''); }, (e) => setError(errorText(e))),
    [],
  );
  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (labId: string, fn: () => Promise<void>) => {
    setBusy(labId);
    setError('');
    try { await fn(); await load(); } catch (e) { setError(errorText(e)); } finally { setBusy(null); }
  };
  const request = (labId: string) => act(labId, async () => { await api('POST', '/api/ssh', { labId }); });
  const makePassword = (l: SshLabView) =>
    act(l.labId, async () => { setShown(await api<SshPasswordResponse>('POST', `/api/ssh/${l.account!.id}/password`)); });

  if (!labs?.length) return error ? <Alert>{error}</Alert> : null;

  return (
    <section aria-labelledby="ssh-title" className="pt-4">
      <h2 id="ssh-title" className="text-lg font-bold">Akun SSH</h2>
      <p className="mt-1 text-sm text-muted">Masuk ke container lab lewat SSH. Akun perlu disetujui admin, lalu dipakai selama kamu punya lease VPN ke lab itu.</p>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      <ul className="panel mt-4 divide-y divide-line">
        {labs.map((l) => {
          const a = l.account;
          const open = a?.status === 'PENDING' || a?.status === 'APPROVED';
          return (
            <li key={l.labId} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold">{l.labName}</p>
                {!a && <p className="text-sm text-muted">Belum punya akun SSH di lab ini.</p>}
                {a?.status === 'PENDING' && (
                  <p className="text-sm text-wait">Menunggu persetujuan admin · diajukan {formatDateTime(a.requestedAt)}</p>
                )}
                {a?.status === 'APPROVED' && (
                  <>
                    <p className="text-sm text-go">
                      Disetujui. Username <b>{a.username}</b>{a.passwordSet ? '.' : ', buat password untuk mulai masuk.'}
                    </p>
                    <p className="mt-1.5 text-sm"><code className="rounded bg-mist px-1.5 py-0.5">ssh {a.username}@{l.host}</code></p>
                    <p className="mt-1 text-xs text-muted">Butuh lease VPN aktif ke lab ini.</p>
                  </>
                )}
                {(a?.status === 'REJECTED' || a?.status === 'REVOKED') && (
                  <p className="text-sm text-stop">
                    {a.status === 'REJECTED' ? 'Ditolak' : 'Dicabut'}{a.decidedAt ? ` ${formatDateTime(a.decidedAt)}` : ''}
                    {a.reason && <>. Alasan: {a.reason}</>}
                  </p>
                )}
              </div>
              <div className="shrink-0">
                {!open && (
                  <button type="button" className="btn btn-ghost min-h-9 w-full px-3 sm:w-auto" disabled={busy === l.labId} onClick={() => request(l.labId)}>
                    {busy === l.labId ? 'Mengajukan…' : a ? 'Ajukan lagi' : 'Ajukan'}
                  </button>
                )}
                {a?.status === 'APPROVED' && (
                  <button type="button" className="btn btn-primary min-h-9 w-full px-3 sm:w-auto" disabled={busy === l.labId} onClick={() => makePassword(l)}>
                    {busy === l.labId ? 'Membuat…' : a.passwordSet ? 'Buat ulang password' : 'Buat password'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <PasswordDialog data={shown} onClose={() => setShown(null)} />
    </section>
  );
}

// The password lives only in this dialog's props; closing drops it.
function PasswordDialog({ data, onClose }: { data: SshPasswordResponse | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (data && !d.open) { setCopied(false); d.showModal(); }
    if (!data && d.open) d.close();
  }, [data]);
  const copy = () => { if (data) navigator.clipboard.writeText(data.password).then(() => setCopied(true), () => setCopied(false)); };
  return (
    <dialog
      ref={ref} onClose={onClose} aria-labelledby="pw-title"
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl bg-white p-0 text-ink shadow-xl"
    >
      {data && (
        <div className="space-y-4 p-5">
          <h2 id="pw-title" className="text-lg font-bold">Password SSH kamu</h2>
          <Alert tone="warn">Password ini hanya ditampilkan sekali. Simpan sekarang.</Alert>
          <div>
            <p className="label">Password</p>
            <div className="flex gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg border border-line bg-mist px-3 py-2 font-mono text-base tracking-wide">{data.password}</code>
              <button type="button" className="btn btn-ghost shrink-0" onClick={copy}>{copied ? 'Tersalin' : 'Salin'}</button>
            </div>
          </div>
          <div>
            <p className="label">Cara masuk</p>
            <code className="block break-all rounded-lg border border-line bg-mist px-3 py-2 font-mono text-sm">ssh {data.username}@{data.host}</code>
            <p className="mt-1 text-xs text-muted">Nyalakan dulu tunnel WireGuard untuk lab ini. Password lama tidak berlaku lagi.</p>
          </div>
          <div className="flex justify-end">
            <button type="button" className="btn btn-primary" onClick={() => ref.current?.close()}>Sudah saya simpan</button>
          </div>
        </div>
      )}
    </dialog>
  );
}
