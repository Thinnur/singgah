import { useEffect, useRef, useState } from 'react';
import { api, errorText, type LeaseView } from '../api.ts';
import { Alert } from '../ui.tsx';
import Dashboard from './Dashboard.tsx';
import RequestForm from './RequestForm.tsx';

/** `/`: the active lease's dashboard, or the request form when there is none. */
export default function Home() {
  const [lease, setLease] = useState<LeaseView | null | undefined>(undefined);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const prev = useRef<LeaseView | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const poll = () => api<LeaseView | null>('GET', '/api/leases/current').then(
      (l) => {
        if (!alive) return;
        if (prev.current && !l) setNotice('Lease kamu sudah berakhir. Ajukan lagi kalau masih butuh akses.');
        prev.current = l;
        setLease(l);
        setError('');
      },
      (e) => alive && setError(errorText(e)),
    );
    poll();
    const t = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const released = () => {
    prev.current = null;
    setLease(null);
    setNotice('Lease dilepas. Sisa waktunya kembali ke kuota harian kamu.');
  };

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      {lease === undefined ? null : lease ? (
        <Dashboard lease={lease} onReleased={released} />
      ) : (
        <>
          {notice && <Alert tone="info">{notice}</Alert>}
          <RequestForm />
        </>
      )}
    </div>
  );
}
