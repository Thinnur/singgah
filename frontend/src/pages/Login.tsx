import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api } from '../api.ts';
import { Mark } from '../Layout.tsx';
import { Alert } from '../ui.tsx';

const ERRORS: Record<string, string> = {
  EMAIL_NOT_ALLOWED: 'Gunakan akun @mail.ugm.ac.id atau @ugm.ac.id',
  STATE: 'Login gagal, coba lagi',
  TOKEN: 'Login gagal, coba lagi',
};

export default function Login() {
  const error = useSearchParams()[0].get('error');
  const navigate = useNavigate();

  // Already signed in (e.g. back button): skip the login screen.
  useEffect(() => { api('GET', '/api/me').then(() => navigate('/', { replace: true }), () => {}); }, [navigate]);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Mark className="size-12" />
        <h1 className="mt-6 text-3xl font-extrabold tracking-tight">Masuk ke Singgah</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          Ajukan akses VPN sementara ke jaringan lab UGM. Akses berakhir otomatis sesuai durasi yang kamu pilih.
        </p>
        {error && <div className="mt-6"><Alert>{ERRORS[error] ?? 'Login gagal, coba lagi'}</Alert></div>}
        <a href="/auth/login" className="btn btn-primary mt-8 w-full min-h-12 text-[15px]">
          <svg viewBox="0 0 24 24" className="size-5 rounded-full bg-white p-0.5" aria-hidden="true">
            <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8Z" />
            <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.9A11 11 0 0 0 12 23Z" />
            <path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7H2.1a11 11 0 0 0 0 10l3.7-2.9Z" />
            <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7l3.7 2.9C6.7 7.3 9.1 5.4 12 5.4Z" />
          </svg>
          Masuk dengan Google
        </a>
        <p className="mt-4 text-center text-xs text-muted">Khusus akun @mail.ugm.ac.id dan @ugm.ac.id.</p>
        <p className="mt-6 text-center text-xs text-muted">
          <a href="/privasi" className="underline">Kebijakan privasi</a> · <a href="/ketentuan" className="underline">Ketentuan layanan</a>
        </p>
      </div>
    </main>
  );
}
