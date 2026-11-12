import { useEffect, useState, type FormEvent } from 'react';
import { api, errorText, type AdminLab } from '../api.ts';
import { Alert, PageHead } from '../ui.tsx';

const HOURS = [1, 2, 4];

function HoursSelect({ id, value, onChange }: { id: string; value: number; onChange: (h: number) => void }) {
  return (
    <select id={id} className="field" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {HOURS.map((h) => <option key={h} value={h}>{h} jam</option>)}
    </select>
  );
}

export default function AdminLabs() {
  const [labs, setLabs] = useState<AdminLab[] | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ id: 'lab-', name: '', targetCidr: '', maxHours: 2 });
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{ id: string; name: string; maxHours: number } | null>(null);

  const load = () => api<AdminLab[]>('GET', '/api/admin/labs').then(setLabs, (e) => setError(errorText(e)));
  useEffect(() => { load(); }, []);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      await api('POST', '/api/admin/labs', { ...form, id: form.id.trim(), targetCidr: form.targetCidr.trim() });
      setForm({ id: 'lab-', name: '', targetCidr: '', maxHours: 2 });
      await load();
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id: string, body: Partial<Pick<AdminLab, 'name' | 'maxHours' | 'isActive'>>) => {
    setError('');
    try {
      await api('PATCH', `/api/admin/labs/${id}`, body);
      setEdit(null);
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <PageHead title="Lab">
          Lab nonaktif tidak bisa diajukan, tapi lease yang sedang berjalan tetap sampai habis. CIDR tidak bisa diubah setelah lab dibuat.
        </PageHead>
        {error && <div className="mb-4"><Alert>{error}</Alert></div>}
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="border-b border-line bg-mist/60">
              <tr>
                <th className="th">Lab</th>
                <th className="th">CIDR tujuan</th>
                <th className="th">Durasi maksimal</th>
                <th className="th">Status</th>
                <th className="th"><span className="sr-only">Aksi</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {labs?.map((l) => edit?.id === l.id ? (
                <tr key={l.id} className="bg-mist/40">
                  <td className="td">
                    <label htmlFor={`name-${l.id}`} className="sr-only">Nama lab</label>
                    <input id={`name-${l.id}`} className="field" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                    <span className="mt-1 block text-xs text-muted">{l.id}</span>
                  </td>
                  <td className="td tabular-nums">{l.targetCidr}</td>
                  <td className="td">
                    <label htmlFor={`hours-${l.id}`} className="sr-only">Durasi maksimal</label>
                    <HoursSelect id={`hours-${l.id}`} value={edit.maxHours} onChange={(h) => setEdit({ ...edit, maxHours: h })} />
                  </td>
                  <td className="td" />
                  <td className="td">
                    <div className="flex justify-end gap-2">
                      <button type="button" className="btn btn-ghost min-h-9 px-3" onClick={() => setEdit(null)}>Batal</button>
                      <button type="button" className="btn btn-primary min-h-9 px-3" onClick={() => patch(l.id, { name: edit.name, maxHours: edit.maxHours })}>Simpan</button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={l.id}>
                  <td className="td">
                    <span className="block font-medium">{l.name}</span>
                    <span className="block text-xs text-muted">{l.id}</span>
                  </td>
                  <td className="td tabular-nums">{l.targetCidr}</td>
                  <td className="td">{l.maxHours} jam</td>
                  <td className="td">
                    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${l.isActive ? 'text-go' : 'text-muted'}`}>
                      <span className={`size-2 rounded-full ${l.isActive ? 'bg-go' : 'bg-line'}`} aria-hidden="true" />
                      {l.isActive ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </td>
                  <td className="td">
                    <div className="flex justify-end gap-2">
                      <button type="button" className="btn btn-ghost min-h-9 px-3" onClick={() => setEdit({ id: l.id, name: l.name, maxHours: l.maxHours })}>Ubah</button>
                      <button type="button" className="btn btn-ghost min-h-9 px-3" onClick={() => patch(l.id, { isActive: !l.isActive })}>
                        {l.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {labs?.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted">Belum ada lab. Tambahkan lewat formulir di bawah.</p>}
        </div>
      </div>

      <form onSubmit={add} className="panel space-y-4 p-5 sm:p-6">
        <h2 className="text-lg font-bold">Tambah lab</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="lab-id" className="label">ID lab</label>
            <input id="lab-id" required className="field" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="lab-jarkom" />
          </div>
          <div>
            <label htmlFor="lab-name" className="label">Nama</label>
            <input id="lab-name" required className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Lab Jaringan Komputer" />
          </div>
          <div>
            <label htmlFor="lab-cidr" className="label">CIDR tujuan</label>
            <input id="lab-cidr" required className="field" value={form.targetCidr} onChange={(e) => setForm({ ...form, targetCidr: e.target.value })} placeholder="192.168.40.0/24" />
          </div>
          <div>
            <label htmlFor="lab-hours" className="label">Durasi maksimal</label>
            <HoursSelect id="lab-hours" value={form.maxHours} onChange={(h) => setForm({ ...form, maxHours: h })} />
          </div>
        </div>
        <p className="text-xs text-muted">ID memakai format lab-&lt;huruf kecil/angka&gt; dan tidak bisa diubah. CIDR tidak boleh bentrok dengan lab lain atau jaringan internal gateway.</p>
        {formError && <Alert>{formError}</Alert>}
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Tambah lab'}</button>
      </form>
    </div>
  );
}
