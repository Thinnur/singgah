import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

export function Alert({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'info' | 'warn' }) {
  const cls = {
    error: 'border-stop/30 bg-red-50 text-stop',
    info: 'border-go/30 bg-teal-50 text-go',
    warn: 'border-amber-300 bg-amber-50 text-amber-900',
  }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${cls}`}>
      {children}
    </div>
  );
}

export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Modal confirmation on the native <dialog>; with `reasonLabel` it also asks for a required reason. */
export function ConfirmDialog(p: {
  open: boolean; title: string; children?: ReactNode; confirmLabel: string; busy?: boolean; error?: string;
  reasonLabel?: string; onConfirm: (reason: string) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (p.open && !d.open) { setReason(''); d.showModal(); }
    if (!p.open && d.open) d.close();
  }, [p.open]);
  const submit = (e: FormEvent) => { e.preventDefault(); p.onConfirm(reason.trim()); };
  return (
    <dialog
      ref={ref}
      onClose={p.onClose}
      aria-labelledby="dlg-title"
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl bg-white p-0 text-ink shadow-xl"
    >
      <form onSubmit={submit} className="space-y-4 p-5">
        <h2 id="dlg-title" className="text-lg font-bold">{p.title}</h2>
        {p.children && <div className="text-sm text-muted">{p.children}</div>}
        {p.reasonLabel && (
          <div>
            <label htmlFor="dlg-reason" className="label">{p.reasonLabel}</label>
            <textarea
              id="dlg-reason" required rows={3} className="field" value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        )}
        {p.error && <Alert>{p.error}</Alert>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-ghost" onClick={p.onClose}>Batal</button>
          <button type="submit" className="btn btn-danger" disabled={p.busy || (!!p.reasonLabel && !reason.trim())}>
            {p.busy ? 'Memproses…' : p.confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {children && <p className="mt-1 text-sm text-muted">{children}</p>}
    </div>
  );
}
