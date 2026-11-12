import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import QRCode from 'qrcode';
import type { IssueResponse } from '../api.ts';
import { formatTime } from '../lib/time.ts';
import { Alert, PageHead } from '../ui.tsx';

const STEPS = [
  ['Pasang aplikasi WireGuard', 'Tersedia gratis di Play Store, App Store, dan wireguard.com untuk laptop.'],
  ['Tambahkan tunnel', 'Di HP, pilih tambah tunnel lalu scan QR. Di laptop, impor file .conf yang kamu unduh.'],
  ['Aktifkan tunnel', 'Nyalakan tunnel Singgah. Akses lab terbuka sampai lease berakhir.'],
] as const;

export default function Result() {
  const location = useLocation();
  const navigate = useNavigate();
  const [issued] = useState(() => (location.state as IssueResponse | null) ?? null);
  const [qr, setQr] = useState('');

  useEffect(() => {
    // Drop the private key from the history entry so a reload or Back cannot show it again.
    if (location.state) navigate(location.pathname, { replace: true, state: null });
    if (issued) QRCode.toDataURL(issued.config, { width: 320, margin: 1, errorCorrectionLevel: 'M' }).then(setQr);
  }, []); // once, on arrival

  if (!issued) {
    return (
      <div className="space-y-4">
        <PageHead title="Konfigurasi sudah tidak tersedia" />
        <Alert tone="warn">Konfigurasi ini hanya ditampilkan sekali. Kalau hilang, lepas lease lalu ajukan lagi.</Alert>
        <Link to="/" className="btn btn-primary">Ke dashboard</Link>
      </div>
    );
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([issued.config], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: issued.filename });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-6">
      <PageHead title="Akses siap dipasang">
        {issued.lease.labName}, IP tunnel {issued.lease.tunnelIp}, berlaku sampai {formatTime(issued.lease.expiresAt)}.
      </PageHead>

      <Alert tone="warn">
        <strong className="font-semibold">Konfigurasi ini hanya ditampilkan sekali. Kalau hilang, lepas lease lalu ajukan lagi.</strong>
      </Alert>

      <div className="panel grid gap-6 p-5 sm:grid-cols-[auto_1fr] sm:gap-8 sm:p-6">
        <div className="mx-auto w-full max-w-64 sm:w-64">
          <div className="aspect-square rounded-lg border border-line bg-white p-2">
            {qr && <img src={qr} alt="QR konfigurasi WireGuard" className="size-full [image-rendering:pixelated]" />}
          </div>
          <button type="button" onClick={download} className="btn btn-primary mt-4 w-full">
            <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden="true">
              <path d="M10 2.5a.75.75 0 0 1 .75.75v8.19l2.72-2.72a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 0 1 1.06-1.06l2.72 2.72V3.25A.75.75 0 0 1 10 2.5ZM3.5 14.75a.75.75 0 0 1 .75.75v.75h11.5v-.75a.75.75 0 0 1 1.5 0v1.5a.75.75 0 0 1-.75.75H4.25a.75.75 0 0 1-.75-.75v-1.5a.75.75 0 0 1 .75-.75Z" />
            </svg>
            Unduh file .conf
          </button>
        </div>

        <ol className="space-y-5">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="flex gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-bold text-white">{i + 1}</span>
              <span>
                <span className="block font-semibold">{title}</span>
                <span className="mt-0.5 block text-sm leading-relaxed text-muted">{body}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      <Link to="/" className="btn btn-ghost w-full sm:w-auto">Lanjut ke dashboard</Link>
    </div>
  );
}
