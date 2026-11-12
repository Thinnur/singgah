import { useEffect, useState, type FormEvent } from 'react';
import { api, errorText, type AuditEntry } from '../api.ts';
import { formatBytes, formatDateTime, formatMinutes } from '../lib/time.ts';
import { Alert, PageHead } from '../ui.tsx';

const ACTION: Record<AuditEntry['action'], [string, string]> = {
  ISSUED: ['Diterbitkan', 'bg-teal-50 text-go'],
  REVOKED: ['Dicabut', 'bg-red-50 text-stop'],
  EXPIRED: ['Kedaluwarsa', 'bg-mist text-muted'],
  CLOSED: ['Ditutup', 'bg-mist text-muted'],
};
const EMPTY = { ip: '', email: '', from: '', to: '' };

// Date inputs are WIB calendar days; the API wants epoch ms.
const wib = (day: string, end: boolean) => String(Date.parse(`${day}T${end ? '23:59:59.999' : '00:00:00'}+07:00`));

function detailText(d: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof d.minutes === 'number') parts.push(formatMinutes(d.minutes));
  if (typeof d.reason === 'string') parts.push(d.reason);
  if (typeof d.bytesRx === 'number' && typeof d.bytesTx === 'number') parts.push(`diunggah ${formatBytes(d.bytesRx)}, diunduh ${formatBytes(d.bytesTx)}`);
  if (typeof d.requesterIp === 'string') parts.push(`dari ${d.requesterIp}`);
  return parts.join('; ');
}

export default function AdminAudit() {
  const [filter, setFilter] = useState(EMPTY);
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState('');

  const search = (f: typeof EMPTY) => {
    const q = new URLSearchParams();
    if (f.ip.trim()) q.set('ip', f.ip.trim());
    if (f.email.trim()) q.set('email', f.email.trim());
    if (f.from) q.set('from', wib(f.from, false));
    if (f.to) q.set('to', wib(f.to, true));
    setError('');
    api<AuditEntry[]>('GET', `/api/admin/audit?${q}`).then(setRows, (e) => setError(errorText(e)));
  };
  useEffect(() => { search(EMPTY); }, []);

  const submit = (e: FormEvent) => { e.preventDefault(); search(filter); };
  const reset = () => { setFilter(EMPTY); search(EMPTY); };
  const field = (k: keyof typeof EMPTY) => ({
    id: `f-${k}`, className: 'field', value: filter[k],
    onChange: (e: { target: { value: string } }) => setFilter({ ...filter, [k]: e.target.value }),
  });

  return (
    <div>
      <PageHead title="Audit">Telusuri siapa memakai IP tunnel tertentu dan kapan. Waktu dalam WIB, maksimal 500 baris terbaru.</PageHead>

      <form onSubmit={submit} className="panel mb-6 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-[1fr_1.4fr_1fr_1fr_auto] lg:items-end">
        <div><label htmlFor="f-ip" className="label">IP tunnel</label><input {...field('ip')} placeholder="10.8.0.2" inputMode="decimal" /></div>
        <div><label htmlFor="f-email" className="label">Email</label><input {...field('email')} type="email" placeholder="nama@mail.ugm.ac.id" /></div>
        <div><label htmlFor="f-from" className="label">Dari tanggal</label><input {...field('from')} type="date" /></div>
        <div><label htmlFor="f-to" className="label">Sampai tanggal</label><input {...field('to')} type="date" /></div>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
          <button type="submit" className="btn btn-primary flex-1 lg:flex-none">Cari</button>
          <button type="button" className="btn btn-ghost" onClick={reset}>Atur ulang</button>
        </div>
      </form>

      {error && <div className="mb-4"><Alert>{error}</Alert></div>}

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[820px]">
          <thead className="border-b border-line bg-mist/60">
            <tr>
              <th className="th">Waktu</th>
              <th className="th">Kejadian</th>
              <th className="th">Email</th>
              <th className="th">IP tunnel</th>
              <th className="th">Lab</th>
              <th className="th">Oleh</th>
              <th className="th">Keterangan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows?.map((r) => {
              const [label, cls] = ACTION[r.action] ?? [r.action, 'bg-mist text-muted'];
              return (
                <tr key={r.id}>
                  <td className="td whitespace-nowrap tabular-nums">{formatDateTime(r.at)}</td>
                  <td className="td"><span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${cls}`}>{label}</span></td>
                  <td className="td">{String(r.detail.email ?? '')}</td>
                  <td className="td tabular-nums">{String(r.detail.tunnelIp ?? '')}</td>
                  <td className="td">{String(r.detail.labId ?? '')}</td>
                  <td className="td text-muted">{r.actor}</td>
                  <td className="td text-muted">{detailText(r.detail)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows?.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted">Tidak ada catatan yang cocok dengan filter ini.</p>}
      </div>
    </div>
  );
}
