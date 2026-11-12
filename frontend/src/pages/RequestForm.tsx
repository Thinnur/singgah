import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api, errorText, type IssueResponse, type LabOption, type Me } from '../api.ts';
import { formatMinutes } from '../lib/time.ts';
import { Alert, PageHead } from '../ui.tsx';

export default function RequestForm() {
  const navigate = useNavigate();
  const [labs, setLabs] = useState<LabOption[] | null>(null);
  const [quota, setQuota] = useState<number | null>(null);
  const [labId, setLabId] = useState('');
  const [minutes, setMinutes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api<LabOption[]>('GET', '/api/labs'), api<Me>('GET', '/api/me')]).then(([l, me]) => {
      setLabs(l);
      setQuota(me.quotaMinutesLeft);
      if (l.length === 1) setLabId(l[0].id);
    }, (e) => setError(errorText(e)));
  }, []);

  const lab = labs?.find((l) => l.id === labId);
  const allowed = (d: number) => quota !== null && d <= quota;

  const pickLab = (id: string) => {
    setLabId(id);
    // Keep the chosen duration only if the new lab offers it.
    if (minutes !== null && !labs?.find((l) => l.id === id)?.durations.includes(minutes)) setMinutes(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!lab || minutes === null || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await api<IssueResponse>('POST', '/api/leases', { labId: lab.id, minutes });
      // The config (with the private key) travels only in navigation state, never in storage.
      navigate('/hasil', { state: res });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  if (!labs || quota === null) return error ? <Alert>{error}</Alert> : null;

  return (
    <form onSubmit={submit} className="space-y-8">
      <PageHead title="Ajukan akses lab">
        Pilih lab dan lama akses. Konfigurasi WireGuard dibuat begitu kamu mengajukan.
      </PageHead>

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-xl bg-ink px-5 py-4 text-white">
        <span className="text-sm text-white/75">Sisa kuota hari ini</span>
        <span className="text-xl font-bold tabular-nums">{formatMinutes(quota)}</span>
        <span className="w-full text-xs text-white/60">Kuota pulih pukul 00.00 WIB. Melepas lease lebih awal mengembalikan sisa waktunya.</span>
      </div>

      {labs.length === 0 ? (
        <Alert tone="warn">Belum ada lab yang dibuka. Hubungi admin lab kamu.</Alert>
      ) : (
        <>
          <fieldset>
            <legend className="label">Lab</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {labs.map((l) => (
                <label
                  key={l.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border bg-white p-4 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink ${
                    l.id === labId ? 'border-ink ring-1 ring-ink' : 'border-line hover:border-ink/40'}`}
                >
                  <input
                    type="radio" name="lab" value={l.id} checked={l.id === labId} onChange={() => pickLab(l.id)}
                    className="mt-1 size-4 accent-ink focus-visible:outline-none"
                  />
                  <span>
                    <span className="block font-semibold">{l.name}</span>
                    <span className="mt-0.5 block text-xs text-muted">{l.id}, maksimal {formatMinutes(l.maxHours * 60)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset disabled={!lab}>
            <legend className="label">Durasi</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(lab?.durations ?? [60, 120, 240]).map((d) => (
                <label
                  key={d}
                  className={`relative flex min-h-12 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink ${
                    !lab || !allowed(d) ? 'cursor-not-allowed border-line bg-mist text-muted/60'
                      : d === minutes ? 'cursor-pointer border-ink bg-ink text-white'
                        : 'cursor-pointer border-line bg-white hover:border-ink/40'}`}
                >
                  <input
                    type="radio" name="minutes" value={d} className="sr-only"
                    checked={d === minutes} disabled={!lab || !allowed(d)} onChange={() => setMinutes(d)}
                  />
                  {formatMinutes(d)}
                </label>
              ))}
            </div>
            {lab && lab.durations.some((d) => !allowed(d)) && (
              <p className="mt-2 text-xs text-muted">Durasi yang melebihi sisa kuota hari ini tidak bisa dipilih.</p>
            )}
            {!lab && <p className="mt-2 text-xs text-muted">Pilih lab dulu.</p>}
          </fieldset>

          {error && <Alert>{error}</Alert>}

          <button type="submit" className="btn btn-primary w-full min-h-12 sm:w-auto sm:px-8" disabled={!lab || minutes === null || busy}>
            {busy ? 'Membuat konfigurasi…' : 'Ajukan akses'}
          </button>
        </>
      )}
    </form>
  );
}
