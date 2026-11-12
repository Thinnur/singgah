import { useState } from 'react';
import { api, errorText, type LeaseView } from '../api.ts';
import { formatBytes, formatRemaining, formatTime } from '../lib/time.ts';
import { ConfirmDialog, useNow } from '../ui.tsx';

export default function Dashboard({ lease, onReleased }: { lease: LeaseView; onReleased: () => void }) {
  // shortcut: countdown uses the browser clock; a skewed clock shifts it (the server still expires on time).
  const now = useNow();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const left = lease.expiresAt - now;
  const total = lease.expiresAt - lease.startsAt;

  const release = async () => {
    setBusy(true);
    setError('');
    try {
      await api('POST', `/api/leases/${lease.id}/release`);
      setConfirm(false);
      onReleased();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="lease-title">
      <h1 className="sr-only">Lease aktif</h1>
      {/* The lease shown as a visitor pass: navy stub with the countdown, white body with the details. */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_0_var(--color-line),0_12px_32px_-16px_rgb(20_33_61/0.35)]">
        <div className="bg-ink px-5 pb-6 pt-5 text-white sm:px-8 sm:pt-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-white/65">Lease aktif</p>
              <h2 id="lease-title" className="mt-0.5 text-xl font-bold leading-snug">{lease.labName}</h2>
            </div>
            {lease.peerActive ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-teal-400/15 px-3 py-1 text-sm font-semibold text-teal-200">
                <span className="size-2 rounded-full bg-teal-300" aria-hidden="true" />
                Siap dipakai
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-full bg-gold/15 px-3 py-1 text-sm font-semibold text-gold">
                <span className="size-2 animate-pulse rounded-full bg-gold motion-reduce:animate-none" aria-hidden="true" />
                Menunggu gateway…
              </span>
            )}
          </div>
          <p className="mt-8 text-sm text-white/65">Sisa waktu</p>
          <p className="text-[clamp(3rem,15vw,5rem)] font-extrabold leading-none tracking-tight tabular-nums" aria-live="off">
            {formatRemaining(left)}
          </p>
          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/15" aria-hidden="true">
            <div className="h-full rounded-full bg-gold" style={{ width: `${Math.max(0, Math.min(1, left / total)) * 100}%` }} />
          </div>
          <p className="mt-3 text-sm text-white/75">
            {left > 0 ? `Berakhir pukul ${formatTime(lease.expiresAt)}` : 'Waktu habis. Akses sedang ditutup…'}
          </p>
        </div>

        <div className="relative" aria-hidden="true">
          <div className="absolute -left-3 -top-3 size-6 rounded-full bg-mist" />
          <div className="absolute -right-3 -top-3 size-6 rounded-full bg-mist" />
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-5 px-5 py-6 sm:grid-cols-3 sm:px-8">
          <div className="col-span-2 sm:col-span-1">
            <dt className="text-xs text-muted">IP tunnel</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{lease.tunnelIp}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Diunggah</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{formatBytes(lease.bytesRx)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Diunduh</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{formatBytes(lease.bytesTx)}</dd>
          </div>
        </dl>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">
          {lease.peerActive
            ? 'Aktifkan tunnel di aplikasi WireGuard untuk masuk ke jaringan lab.'
            : 'Gateway sedang memasang akses kamu. Biasanya beberapa detik.'}
        </p>
        <button type="button" className="btn btn-ghost shrink-0 border-stop/40 text-stop hover:bg-red-50" onClick={() => setConfirm(true)}>
          Lepas Lease
        </button>
      </div>

      <ConfirmDialog
        open={confirm} title="Lepas lease ini?" confirmLabel="Lepas Lease" busy={busy} error={error}
        onConfirm={release} onClose={() => { setConfirm(false); setError(''); }}
      >
        Akses ke {lease.labName} langsung ditutup dan konfigurasi WireGuard kamu tidak berlaku lagi.
        Sisa waktunya kembali ke kuota harian.
      </ConfirmDialog>
    </section>
  );
}
