const pad = (n: number) => String(n).padStart(2, '0');

/** Remaining lease time as h:mm:ss, clamped at 0. */
export function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

const num = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** Decimal (SI) byte size with an Indonesian decimal comma, e.g. "1,5 MB". */
export function formatBytes(n: number): string {
  let i = 0;
  while (Math.abs(n) >= 1000 && i < UNITS.length - 1) { n /= 1000; i++; }
  return `${num.format(n)} ${UNITS[i]}`;
}

/** Minutes as "1 menit" / "2 jam" / "1 jam 30 menit"; fractions (quota left) round down. */
export function formatMinutes(min: number): string {
  const whole = Math.max(0, Math.floor(min));
  const h = Math.floor(whole / 60), m = whole % 60;
  return [h && `${h} jam`, (m || !h) && `${m} menit`].filter(Boolean).join(' ');
}

const dt = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' });
const tm = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', timeStyle: 'short' });
/** Server times are epoch ms; the lab lives in WIB whatever the browser's zone. */
export const formatDateTime = (ms: number) => `${dt.format(ms)} WIB`;
export const formatTime = (ms: number) => `${tm.format(ms)} WIB`;
