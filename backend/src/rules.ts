export const RESERVED_CIDRS = ['10.8.0.0/24', '100.64.0.0/10', '172.16.0.0/12', '10.42.0.0/16', '10.43.0.0/16', '192.168.1.0/24'];

export function normalizeEmail(e: string): string {
  return e.trim().toLowerCase();
}

export function isEmailAllowed(email: string, extra: string[]): boolean {
  const n = normalizeEmail(email);
  return n.endsWith('@mail.ugm.ac.id') || n.endsWith('@ugm.ac.id') || extra.map(normalizeEmail).includes(n);
}

export function allowedDurations(maxHours: number, testMode: boolean): number[] {
  const base = [60, 120, 240].filter((m) => m <= maxHours * 60);
  return testMode ? [1, ...base] : base;
}

const WIB_MS = 7 * 3600_000;
const DAY_MS = 24 * 3600_000;

export function wibDayStart(nowMs: number): number {
  return Math.floor((nowMs + WIB_MS) / DAY_MS) * DAY_MS - WIB_MS;
}

export function nextWibMidnight(nowMs: number): number {
  return wibDayStart(nowMs) + DAY_MS;
}

export function usedMinutesToday(
  leases: { starts_at: number; expires_at: number; revoked_at: number | null }[],
  nowMs: number,
): number {
  const dayStart = wibDayStart(nowMs);
  let ms = 0;
  for (const l of leases) {
    if (l.starts_at < dayStart) continue;
    ms += Math.max(0, Math.min(nowMs, l.revoked_at ?? Infinity, l.expires_at) - l.starts_at);
  }
  return ms / 60_000;
}

export type RejectCode = 'LAB_UNAVAILABLE' | 'BAD_DURATION' | 'HAS_ACTIVE' | 'QUOTA' | 'POOL_FULL';
export type Rejection = { code: RejectCode; message: string; status: number };

export function checkLeaseRequest(i: {
  lab: { is_active: number; max_hours: number } | undefined;
  minutes: number;
  hasActive: boolean;
  usedMinutes: number;
  quotaHours: number;
  testMode: boolean;
  nowMs: number;
}): Rejection | null {
  if (!i.lab || !i.lab.is_active) {
    return { code: 'LAB_UNAVAILABLE', message: 'Lab sedang tidak tersedia', status: 404 };
  }
  const durations = allowedDurations(i.lab.max_hours, i.testMode);
  if (!durations.includes(i.minutes)) {
    return {
      code: 'BAD_DURATION',
      message: `Durasi tidak valid. Pilihan: ${durations.join(', ')} menit (batas lab ${i.lab.max_hours} jam)`,
      status: 400,
    };
  }
  if (i.hasActive) return { code: 'HAS_ACTIVE', message: 'Kamu masih punya lease aktif', status: 409 };
  const remaining = Math.max(0, i.quotaHours * 60 - i.usedMinutes);
  if (i.minutes > remaining) {
    return {
      code: 'QUOTA',
      message: `Kuota harian habis, sisa ${Math.floor(remaining)} menit, pulih pukul 00.00 WIB`,
      status: 429,
    };
  }
  return null;
}

// Rejection for a full pool is raised by the caller when allocateIp returns null.
export const POOL_FULL: Rejection = { code: 'POOL_FULL', message: 'Kapasitas sedang penuh, coba lagi nanti', status: 503 };

export function allocateIp(taken: Set<string>): string | null {
  for (let i = 2; i <= 254; i++) {
    const ip = `10.8.0.${i}`;
    if (!taken.has(ip)) return ip;
  }
  return null;
}

export function parseCidr(c: string): { net: number; bits: number } {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(c);
  if (!m) throw new Error(`CIDR tidak valid: ${c}`);
  const o = m.slice(1, 5).map(Number);
  const bits = Number(m[5]);
  if (o.some((x) => x > 255) || bits > 32) throw new Error(`CIDR tidak valid: ${c}`);
  const net = ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  if ((net & mask) >>> 0 !== net) throw new Error(`CIDR punya host bit: ${c}`);
  return { net, bits };
}

export function cidrOverlaps(a: string, b: string): boolean {
  const x = parseCidr(a);
  const y = parseCidr(b);
  const bits = Math.min(x.bits, y.bits);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((x.net & mask) >>> 0) === ((y.net & mask) >>> 0);
}
