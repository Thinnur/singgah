import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { api, errorText, type Me } from './api.ts';
import { Alert } from './ui.tsx';

export type Ctx = { me: Me };

export function Mark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-ink" />
      <path d="M9 21.5c1.6 1.3 3.9 2 6.3 2 3.6 0 6.2-1.7 6.2-4.6 0-5.6-11-3.4-11-8 0-1.7 1.8-2.9 4.4-2.9 1.9 0 3.6.5 5 1.5"
        fill="none" className="stroke-gold" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const NAV = [
  ['/', 'Akses Lab'], ['/admin/leases', 'Lease'], ['/admin/labs', 'Lab'], ['/admin/audit', 'Audit'], ['/admin/stats', 'Statistik'],
] as const;

export default function Layout() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState('');
  const wide = useLocation().pathname.startsWith('/admin');

  useEffect(() => { api<Me>('GET', '/api/me').then(setMe, (e) => setError(errorText(e))); }, []);

  const logout = () => api('POST', '/auth/logout').finally(() => location.assign('/login'));

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-white">
        <div className={`mx-auto flex items-center gap-3 px-4 py-3 ${wide ? 'max-w-6xl' : 'max-w-3xl'}`}>
          <a href="/" className="flex items-center gap-2.5 rounded-md">
            <Mark />
            <span className="leading-tight">
              <span className="block text-base font-extrabold tracking-tight">Singgah</span>
              <span className="block text-xs text-muted">Akses Lab UGM</span>
            </span>
          </a>
          {me && (
            <div className="ml-auto flex min-w-0 items-center gap-3">
              <span className="hidden truncate text-sm text-muted sm:block" title={me.email}>{me.email}</span>
              <button type="button" onClick={logout} className="btn btn-ghost min-h-9 px-3">Keluar</button>
            </div>
          )}
        </div>
        {me?.role === 'admin' && (
          <nav aria-label="Menu" className={`mx-auto -mb-px flex overflow-x-auto px-1.5 sm:gap-1 sm:px-2 ${wide ? 'max-w-6xl' : 'max-w-3xl'}`}>
            {NAV.map(([to, label]) => (
              <NavLink
                key={to} to={to} end
                className={({ isActive }) =>
                  `shrink-0 border-b-2 px-2.5 py-2.5 text-sm font-semibold sm:px-3 ${isActive ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}
              >
                {label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>
      <main className={`mx-auto px-4 py-6 sm:py-10 ${wide ? 'max-w-6xl' : 'max-w-3xl'}`}>
        {error && <Alert>{error}</Alert>}
        {me && <Outlet context={{ me } satisfies Ctx} />}
      </main>
    </div>
  );
}
