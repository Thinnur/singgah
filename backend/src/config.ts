export type Config = {
  port: number;
  publicUrl: string;
  dbPath: string;
  testMode: boolean;
  googleClientId: string;
  googleClientSecret: string;
  adminEmails: string[];
  extraAllowedEmails: string[];
  dailyQuotaHours: number;
  reconcileIntervalS: number;
  wgInterface: string;
  wgServerPubkey: string;
  wgEndpoint: string;
  trustedProxyIp: string;
  labAccountsDir: string;
};

type Env = Record<string, string | undefined>;

const list = (v?: string) =>
  (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export function loadConfig(env: Env): Config {
  const testMode = env.TEST_MODE === '1';
  const need = (k: string) => {
    const v = env[k];
    if (!v && !testMode) throw new Error(`Variabel ${k} wajib diisi`);
    return v ?? '';
  };
  const num = (k: string, d: number) => {
    const n = env[k] === undefined || env[k] === '' ? d : Number(env[k]);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`Variabel ${k} harus angka positif`);
    return n;
  };
  const port = num('PORT', 8780);
  return {
    port,
    publicUrl: env.PUBLIC_URL || `http://localhost:${port}`,
    dbPath: env.DB_PATH || '/var/lib/singgah/singgah.db',
    testMode,
    googleClientId: need('GOOGLE_CLIENT_ID'),
    googleClientSecret: need('GOOGLE_CLIENT_SECRET'),
    adminEmails: list(env.ADMIN_EMAILS),
    extraAllowedEmails: list(env.EXTRA_ALLOWED_EMAILS),
    dailyQuotaHours: num('DAILY_QUOTA_HOURS', 8),
    reconcileIntervalS: num('RECONCILE_INTERVAL_S', 5),
    wgInterface: env.WG_INTERFACE || 'wg0',
    wgServerPubkey: env.WG_SERVER_PUBKEY || 'DEgt5zLQb88/fJzae0f/U+kdcPmgWkyzWwwYJ7UtM2Y=',
    wgEndpoint: env.WG_ENDPOINT || '103.93.133.235:51820',
    trustedProxyIp: env.TRUSTED_PROXY_IP || '100.68.122.86',
    labAccountsDir: env.LAB_ACCOUNTS_DIR || '/var/lib/singgah/labs',
  };
}
