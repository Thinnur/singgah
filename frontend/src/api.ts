import type { ApiError } from '../../backend/src/api/types.ts';

export type {
  AdminLab, AdminLease, ApiError, AuditEntry, IssueResponse, LabOption, LeaseView, Me, Stats,
} from '../../backend/src/api/types.ts';

/** Thrown for every non-2xx response; `message` is the server's Indonesian text, shown as-is. */
export class ApiFailure extends Error implements ApiError {
  code: string;
  status: number;
  constructor(status: number, e: ApiError) {
    super(e.message);
    this.code = e.code;
    this.status = status;
  }
}

export async function api<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json' },
      // The API's CSRF gate wants a JSON body on every POST/PATCH, even an empty one.
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiFailure(0, { code: 'NETWORK', message: 'Tidak bisa menghubungi server. Periksa koneksi lalu coba lagi.' });
  }
  if (res.status === 401 && location.pathname !== '/login') location.assign('/login');
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data as Partial<ApiError> | null;
    throw new ApiFailure(res.status, {
      code: e?.code ?? 'HTTP_' + res.status,
      message: e?.message ?? `Terjadi kesalahan (HTTP ${res.status}). Coba lagi.`,
    });
  }
  return data as T;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
