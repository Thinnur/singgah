# Singgah Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun portal swalayan Singgah (web API, worker rekonsiliasi, frontend React) di atas gateway WireGuard yang sudah berjalan, lalu memasangnya di laptop sebagai service systemd.

**Architecture:** Satu repo dengan npm workspaces. `backend/` (TypeScript yang dijalankan langsung oleh Node 24 lewat *type stripping*, tanpa langkah build) berisi dua entry point: `singgah-api` (Fastify, user tanpa hak khusus) dan `singgah-worker` (CAP_NET_ADMIN, menjalankan `wg`/`nft`). Keduanya hanya berkomunikasi lewat SQLite (`node:sqlite`). `frontend/` (React + Vite + Tailwind) di-build menjadi file statis yang disajikan API. Kode dikembangkan dan diuji unit di VPS, lalu dipasang di laptop lewat `git pull` dengan deploy key read-only.

**Tech Stack:** Node.js 24 (VPS v24.22.1; di laptop dipasang terpisah di `/opt/node-v24.22.1`), TypeScript 5, Fastify 5 + `@fastify/cookie` + `@fastify/static`, `node:sqlite`, `node:test`, React 19 + Vite + Tailwind CSS 4 + `react-router` + `qrcode`, Vitest (frontend saja), systemd, WireGuard (`wg`), nftables (`nft`).

**Spec:** `docs/2026-11-12-singgah-design.md` (di repo: `docs/design.md`). Rujukan "§x" di bawah merujuk ke dokumen itu, dan "PRD x.y" ke `docs/PRD-VPN-Gateway.md`.

## Global Constraints

- Node ≥ 24.22.1. TypeScript dijalankan langsung (`node src/x.ts`). Hanya sintaks yang bisa dihapus (*erasable*): tanpa `enum`, `namespace`, *parameter properties*. Import relatif wajib berakhiran `.ts`. Typecheck: `tsc --noEmit` dengan `"erasableSyntaxOnly": true, "allowImportingTsExtensions": true, "noEmit": true`.
- Dependency backend **hanya**: `fastify`, `@fastify/cookie`, `@fastify/static`. Dev: `typescript`, `@types/node`. Selain itu dipakai platform: `node:sqlite`, `node:crypto`, `node:test`, `fetch`.
- Dependency frontend **hanya**: `react`, `react-dom`, `react-router`, `qrcode`, `tailwindcss`, `@tailwindcss/vite`. Dev: `vite`, `@vitejs/plugin-react`, `typescript`, `@types/react`, `@types/react-dom`, `@types/qrcode`, `vitest`.
- Semua waktu disimpan sebagai **INTEGER milidetik epoch UTC**. "Hari" kuota = hari kalender **Asia/Jakarta (UTC+7, tanpa DST)**.
- Durasi lease dalam **menit**: `60, 120, 240`, ditambah `1` saat `TEST_MODE=1`. Durasi juga tidak boleh melebihi `max_hours*60` lab.
- Kuota default `DAILY_QUOTA_HOURS=8`. Interval worker default `RECONCILE_INTERVAL_S=5`. Port API default `PORT=8780`.
- Pool tunnel `10.8.0.0/24`, alokasi `10.8.0.2`–`10.8.0.254`, pilih IP bebas terkecil. Gateway `10.8.0.1`.
- Teks konfigurasi klien harus persis sama dengan §8: `MTU = 1200`, `PersistentKeepalive = 25`, `AllowedIPs = 10.8.0.1/32, <target_cidr>`. Endpoint default `103.93.133.235:51820`. Pubkey gateway `DEgt5zLQb88/fJzae0f/U+kdcPmgWkyzWwwYJ7UtM2Y=`.
- Email diterima jika (setelah `trim().toLowerCase()`) berakhiran `@mail.ugm.ac.id` atau `@ugm.ac.id`, atau ada di `EXTRA_ALLOWED_EMAILS`.
- **Private key klien tidak pernah** ditulis ke disk, database, atau log.
- nftables: worker **hanya** menyentuh table `ip s5gw`. Nama set `lab_<id tanpa "lab-">` (mis. `lab-cyber` → `lab_cyber`). Aturan accept per lab diberi `comment "singgah:<lab-id>"`. Jangan pernah `nft flush ruleset`.
- Teks UI dan pesan error API berbahasa **Indonesia**. Kode, nama file, dan identifier berbahasa Inggris.
- Bentuk JSON API memakai camelCase, dan durasi dikirim sebagai `minutes`. Ini sedikit berbeda dari `{lab_id, hours}` di §8 (yang memang diserahkan ke builder), karena mode uji butuh durasi 1 menit.
- Path di laptop: kode `/opt/singgah`, database `/var/lib/singgah/singgah.db`, konfigurasi `/etc/singgah/singgah.env` (root:singgah 0640), user sistem `singgah`.

## Review Focus

1. **Zona waktu proses ≠ WIB.** Laptop atau VPS bisa memakai TZ UTC. Batas hari kuota tetap 00:00 WIB. → test di Task 3 dijalankan dengan `TZ=UTC`.
2. **Klik ganda "Ajukan".** Dua POST bersamaan dari satu pengguna harus menghasilkan satu lease dan satu penolakan `HAS_ACTIVE` (409), bukan error 500. → test di Task 5.
3. **Huruf besar dan spasi di email** (`" User@Mail.UGM.ac.id "`) diperlakukan sama dengan versi huruf kecilnya, tidak membuat user ganda, dan domain tiruan (`a@mail.ugm.ac.id.evil.com`, `a@fakeugm.ac.id`) ditolak. → test di Task 3.
4. **wg0 atau table `s5gw` tidak ada** (wg-quick mati, s5-labs sedang restart). Worker mencatat error lalu mencoba lagi, tidak crash, dan **tidak** menandai lease apa pun EXPIRED/CLOSED secara keliru. → test di Task 7.
5. **API dan worker menulis bersamaan.** Tidak boleh ada `SQLITE_BUSY` yang muncul ke pengguna. `busy_timeout` 5000 ms dan WAL. → test di Task 2.

---

## File Structure

```
singgah/
  package.json                 # npm workspaces: backend, frontend; script test/typecheck
  .gitignore                   # node_modules, dist, *.db*, *.env, *.conf (kecuali infra/**/*.example)
  README.md                    # ringkasan + cara pasang ulang (Task 8)
  docs/PRD-VPN-Gateway.md, docs/design.md, docs/plan.md
  backend/
    package.json, tsconfig.json
    src/config.ts              # loadConfig(env)
    src/db.ts                  # openDb, migrate, assertSchema, skema + seed + trigger
    src/rules.ts               # aturan domain murni: email, durasi, kuota, IP, CIDR
    src/wgkeys.ts              # generateKeyPair, clientConfig
    src/api/types.ts           # tipe respons API (dipakai juga oleh frontend)
    src/api/app.ts             # buildApp(): Fastify + plugin + route + static
    src/api/session.ts         # sesi cookie, requireUser, requireAdmin, clientIp
    src/api/auth.ts            # /auth/login, /auth/callback, /auth/logout, /auth/test-login
    src/api/leases.ts          # /api/me, /api/labs, /api/leases*
    src/api/admin.ts           # /api/admin/*
    src/api/main.ts            # entry point singgah-api
    src/worker/sys.ts          # Sys interface + realSys() (execFile wg/nft)
    src/worker/wgdump.ts       # parseWgDump
    src/worker/nft.ts          # labSetName, labsWithRule, buildNftScript
    src/worker/reconcile.ts    # reconcileOnce
    src/worker/main.ts         # entry point singgah-worker (loop)
    src/cli/lease.ts           # CLI root: add/revoke lease langsung di DB (untuk s5-selftest)
    test/*.test.ts             # node:test
  frontend/
    package.json, tsconfig.json, vite.config.ts, index.html
    src/main.tsx, src/App.tsx, src/api.ts, src/index.css
    src/lib/time.ts (+ time.test.ts)
    src/pages/{Login,Request,Result,Dashboard}.tsx
    src/pages/admin/{Leases,Labs,Audit,Stats}.tsx
  infra/
    vps/{s5-relay.nft,s5-relay.service,README.md}
    laptop/{wg0.conf.example,s5-labs,s5-selftest,s5-labs.service,90-s5-gateway.conf,
            singgah-api.service,singgah-worker.service,singgah.env.example,deploy.sh,install.sh}
```

---

### Task 1: Repo, kerangka, dan salinan infra

**Files:**
- Create: `/root/kerja/singgah/{package.json,.gitignore,README.md}`, `backend/{package.json,tsconfig.json}`, `docs/*`, `infra/vps/*`, `infra/laptop/*` (salinan apa adanya dari mesin, kecuali `wg0.conf.example`)

**Interfaces:**
- Produces: root script `npm test` (= `npm test -w backend && npm test -w frontend --if-present`), `npm run typecheck`. Backend script `test` = `TZ=UTC node --test test/` (TZ sengaja dipaksa UTC, Review Focus 1), `typecheck` = `tsc --noEmit`.

- [ ] **Step 1:** Buat `/root/kerja/singgah`, `git init -b main`. Isi struktur di atas: salin `docs/` dari `/root/kerja/project-s5` (PRD md, desain → `docs/design.md`, rencana ini → `docs/plan.md`), salin `infra/vps/` dari `/etc/s5-relay.nft` dan `/etc/systemd/system/s5-relay.service`, salin `infra/laptop/` dari laptop (`/usr/local/sbin/s5-labs`, `/usr/local/sbin/s5-selftest`, `/etc/systemd/system/s5-labs.service`, `/etc/sysctl.d/90-s5-gateway.conf`). `wg0.conf.example` = `/etc/wireguard/wg0.conf` dengan `PrivateKey = <isi dengan wg genkey>`. `infra/vps/README.md` mencatat langkah Tailscale (`--accept-dns=false`), UFW `41641/udp`, dan `/etc/modules-load.d/tailscale.conf`.
- [ ] **Step 2:** Pasang dependency backend sesuai Global Constraints. Tulis `backend/test/smoke.test.ts` (`assert.equal(1, 1)`) supaya `npm test` punya target.
- [ ] **Step 3: Verifikasi.** Jalankan `npm test && npm run typecheck` (harus PASS), lalu `git grep -nE "PrivateKey = [A-Za-z0-9+/]{43}="` (harus kosong).
- [ ] **Step 4:** Commit `chore: kerangka repo singgah + salinan infra`. Buat repo **private** dengan `gh repo create Thinnur/singgah --private --source . --push`. Verifikasi dengan `gh repo view Thinnur/singgah --json visibility` → `PRIVATE`.

### Task 2: Konfigurasi dan database

**Files:**
- Create: `backend/src/config.ts`, `backend/src/db.ts`
- Test: `backend/test/config.test.ts`, `backend/test/db.test.ts`

**Interfaces:**
- Produces:
  - `type Config = { port: number; publicUrl: string; dbPath: string; testMode: boolean; googleClientId: string; googleClientSecret: string; adminEmails: string[]; extraAllowedEmails: string[]; dailyQuotaHours: number; reconcileIntervalS: number; wgInterface: string; wgServerPubkey: string; wgEndpoint: string; trustedProxyIp: string }`
  - `loadConfig(env: Record<string, string|undefined>): Config`. Daftar email dipisah koma lalu dinormalisasi. `GOOGLE_*` wajib kecuali `TEST_MODE=1`. `trustedProxyIp` default `100.68.122.86`. Tanpa `SESSION_SECRET`, karena sesi memakai ID acak di DB (penyimpangan kecil dari §10, disengaja).
  - `openDb(path: string, opts?: { migrate?: boolean }): DatabaseSync`: WAL, `busy_timeout=5000`, `foreign_keys=ON`, lalu `migrate()` bila `opts.migrate !== false`. API memakai default. Worker memakai `{ migrate: false }` lalu `assertSchema` (§5.4: hanya API yang melakukan migrasi).
  - `SCHEMA_VERSION = 1`, `migrate(db)` (memakai `PRAGMA user_version`), `assertSchema(db)` (throw jika versi ≠ `SCHEMA_VERSION`).
- Skema (kolom persis; waktu dalam ms):
  - `users(id INTEGER PK, email TEXT UNIQUE NOT NULL, name TEXT, role TEXT CHECK(role IN ('student','admin')), created_at, last_login_at)`
  - `labs(id TEXT PK CHECK(id GLOB 'lab-[a-z0-9]*' AND length(id)<=24), name TEXT NOT NULL, target_cidr TEXT NOT NULL, max_hours INTEGER NOT NULL DEFAULT 4, is_active INTEGER NOT NULL DEFAULT 1, created_at)`. Seed: tiga lab §6.
  - `leases(id INTEGER PK, user_id, lab_id, tunnel_ip, client_pubkey UNIQUE, status CHECK IN ('ACTIVE','EXPIRED','REVOKED'), starts_at, expires_at, revoked_at, revoked_by, reason, requester_ip, installed_at, ended_at, bytes_rx INTEGER DEFAULT 0, bytes_tx INTEGER DEFAULT 0, wg_rx_seen INTEGER DEFAULT 0, wg_tx_seen INTEGER DEFAULT 0)`. Indeks unik parsial `ON leases(user_id) WHERE status='ACTIVE'` dan `ON leases(tunnel_ip) WHERE ended_at IS NULL`.
  - `audit_log(id INTEGER PK, lease_id, action CHECK IN ('ISSUED','REVOKED','EXPIRED','CLOSED'), actor TEXT, at INTEGER, detail TEXT /*JSON*/)`, plus trigger `BEFORE UPDATE`/`BEFORE DELETE` → `RAISE(ABORT,'audit_log append-only')`.
  - `sessions(id TEXT PK, user_id, expires_at)`.

- [ ] **Step 1: Tulis test yang gagal.** `db.test.ts`:
  - `seeds three labs`: id `lab-cloud`/`lab-cyber`/`lab-jarkom` dengan CIDR §6.
  - `one ACTIVE lease per user`: insert ACTIVE kedua → throw `UNIQUE`.
  - `tunnel_ip reusable only after ended_at`: lease REVOKED dengan `ended_at` NULL + lease baru IP sama → throw. Setelah `ended_at` diisi → sukses.
  - `audit_log is append-only`: UPDATE dan DELETE → throw `append-only`.
  - `busy_timeout and WAL`: `PRAGMA busy_timeout` → 5000, `PRAGMA journal_mode` → `wal`.
  - `migrate is idempotent`: `openDb` dua kali pada file yang sama → tetap 3 lab.

  `config.test.ts`:
  - `TEST_MODE=1` tanpa `GOOGLE_*` → ok.
  - `TEST_MODE=0` tanpa `GOOGLE_CLIENT_ID` → throw menyebut nama variabelnya.
  - `ADMIN_EMAILS=" A@x.com, b@y.com "` → `['a@x.com','b@y.com']`.
- [ ] **Step 2:** Jalankan `npm test -w backend`. Harus FAIL (modul belum ada).
- [ ] **Step 3:** Implementasikan `config.ts` dan `db.ts` sesuai Interfaces.
- [ ] **Step 4:** Jalankan `npm test -w backend && npm run typecheck`. Harus PASS.
- [ ] **Step 5:** Commit `feat(backend): config dan skema SQLite`.

### Task 3: Aturan domain dan kunci WireGuard

**Files:**
- Create: `backend/src/rules.ts`, `backend/src/wgkeys.ts`
- Test: `backend/test/rules.test.ts`, `backend/test/wgkeys.test.ts`

**Interfaces:**
- Produces (`rules.ts`):
  - `normalizeEmail(e: string): string`, `isEmailAllowed(email: string, extra: string[]): boolean`
  - `allowedDurations(maxHours: number, testMode: boolean): number[]` (menit, urut naik)
  - `wibDayStart(nowMs: number): number`, `nextWibMidnight(nowMs: number): number`
  - `usedMinutesToday(leases: {starts_at: number; expires_at: number; revoked_at: number|null}[], nowMs: number): number`. Hanya lease dengan `starts_at >= wibDayStart(now)`, dan yang dihitung `min(now, revoked_at ?? ∞, expires_at) − starts_at`.
  - `type RejectCode = 'LAB_UNAVAILABLE'|'BAD_DURATION'|'HAS_ACTIVE'|'QUOTA'|'POOL_FULL'`, `type Rejection = { code: RejectCode; message: string; status: number }`
  - `checkLeaseRequest(i: { lab: {is_active: number; max_hours: number}|undefined; minutes: number; hasActive: boolean; usedMinutes: number; quotaHours: number; testMode: boolean; nowMs: number }): Rejection|null`. Urutan dan pesan sesuai §8. Status: LAB_UNAVAILABLE 404, BAD_DURATION 400, HAS_ACTIVE 409, QUOTA 429, POOL_FULL 503. Pesan QUOTA menyebut sisa menit dan "pulih pukul 00.00 WIB".
  - `allocateIp(taken: Set<string>): string|null` (10.8.0.2–254)
  - `parseCidr(c: string): {net: number; bits: number}` (throw jika bukan IPv4/0–32 atau ada host bit), `cidrOverlaps(a: string, b: string): boolean`
  - `RESERVED_CIDRS = ['10.8.0.0/24','100.64.0.0/10','172.16.0.0/12','10.42.0.0/16','10.43.0.0/16','192.168.1.0/24']`
- Produces (`wgkeys.ts`):
  - `generateKeyPair(): { privateKey: string; publicKey: string }` (base64, 32 byte mentah dari DER x25519 Node)
  - `clientConfig(p: { privateKey: string; address: string; serverPubkey: string; endpoint: string; labCidr: string }): string`. Teksnya persis seperti template §8, tanpa baris komentar, diakhiri `\n`.

- [ ] **Step 1: Tulis test yang gagal.**
  - email: `" User@Mail.UGM.ac.id "` → allowed. `a@ugm.ac.id` → allowed. `a@mail.ugm.ac.id.evil.com`, `a@fakeugm.ac.id`, `a@gmail.com` → ditolak. `a@gmail.com` dengan extra `['a@gmail.com']` → allowed.
  - durasi: `allowedDurations(4,false)` → `[60,120,240]`, `(2,false)` → `[60,120]`, `(4,true)` → `[1,60,120,240]`.
  - kuota (jalankan file ini dengan `TZ=UTC`, set di script test): lease 23:00–01:00 WIB dihitung ke hari mulainya. Pada 00:30 WIB hari berikutnya, `usedMinutesToday` = 0. Lease 2 jam yang dilepas setelah 30 menit → 30. `nextWibMidnight(Date.UTC(2026,10,12,10,0))` = `Date.UTC(2026,10,12,17,0)`.
  - `checkLeaseRequest`: setiap kode muncul untuk inputnya. Bila beberapa salah sekaligus, yang menang sesuai urutan §8 (lab nonaktif + punya aktif → LAB_UNAVAILABLE). Tepat di batas (`used 420 + 60 = 480`) → null.
  - IP: kosong → `10.8.0.2`. `{.2,.3}` → `.4`. 253 terpakai → `null`.
  - CIDR: `192.168.20.0/24` vs `192.168.20.128/25` → overlap. `192.168.20.5/24` → throw. `172.20.0.0/16` overlap dengan `172.16.0.0/12`.
  - keys: `createPublicKey(<private dari raw>)` menghasilkan public yang sama. Jika `wg` ada di PATH (`which wg`), `echo priv | wg pubkey` sama (dilewati jika tidak ada).
  - `clientConfig` sama persis dengan string yang diharapkan untuk input tetap.
- [ ] **Step 2:** Jalankan `npm test -w backend`. Harus FAIL.
- [ ] **Step 3:** Implementasikan `rules.ts` dan `wgkeys.ts`. Untuk raw key, ambil 32 byte terakhir dari ekspor DER `pkcs8`/`spki`.
- [ ] **Step 4:** Jalankan `npm test -w backend && npm run typecheck`. Harus PASS.
- [ ] **Step 5:** Commit `feat(backend): aturan lease, kuota WIB, alokasi IP, kunci WireGuard`.

### Task 4: Kerangka API, sesi, dan login

**Files:**
- Create: `backend/src/api/{types.ts,app.ts,session.ts,auth.ts,main.ts}`
- Test: `backend/test/auth.test.ts`

**Interfaces:**
- Consumes: `Config`, `openDb`, `normalizeEmail`, `isEmailAllowed`.
- Produces:
  - `buildApp(o: { db: DatabaseSync; config: Config; fetchFn?: typeof fetch; now?: () => number; staticDir?: string }): FastifyInstance`
  - `session.ts`: `requireUser(req) → {id, email, name, role}` (401 `{code:'UNAUTHENTICATED'}`), `requireAdmin(req)` (403 `{code:'FORBIDDEN'}`), `clientIp(req, trustedProxyIp): string` (pakai `cf-connecting-ip` hanya bila `req.socket.remoteAddress` = trustedProxyIp).
  - Cookie sesi `singgah_sid`: `HttpOnly; SameSite=Lax; Path=/; Secure` bila `publicUrl` diawali `https:`. Masa berlaku 12 jam.
  - CSRF: semua `POST`/`PATCH` di `/api/*` dan `/auth/logout` wajib `content-type: application/json`, selain itu 415.
  - `types.ts`: `Me, LabOption, LeaseView, IssueResponse, ApiError, AdminLease, AuditEntry, Stats` (bentuk di §8. Field camelCase, waktu dalam ms, durasi dalam menit).
  - Rute: `GET /auth/login` (redirect ke `https://accounts.google.com/o/oauth2/v2/auth` dengan `scope=openid email profile`, `state` acak di cookie `singgah_state` 10 menit), `GET /auth/callback` (tukar `code` di `https://oauth2.googleapis.com/token` lewat `fetchFn`, decode `id_token` dan cek `iss ∈ {accounts.google.com, https://accounts.google.com}`, `aud = clientId`, `exp > now`, `email_verified === true`, email diizinkan, lalu upsert user dengan role dari `adminEmails` dan buat sesi, redirect `/`). Bila ditolak, redirect `/login?error=<code>`. Lalu `POST /auth/logout`, `POST /auth/test-login {email}` (404 kecuali `testMode`, 403 kecuali remote address `127.0.0.1`/`::1`/`::ffff:127.0.0.1`), dan `GET /api/me`.
  - `main.ts`: `loadConfig(process.env)` → `openDb` → `buildApp` → listen `0.0.0.0:<port>`.

- [ ] **Step 1: Tulis test yang gagal** (memakai `app.inject`, DB file sementara, `fetchFn` palsu):
  - test-login: 404 saat testMode false. 403 dari `remoteAddress: '10.0.0.5'`. 200 dari loopback dan menyetel cookie. Email `a@gmail.com` → 403 `EMAIL_NOT_ALLOWED`.
  - `/api/me` tanpa cookie → 401. Dengan cookie → email ternormalisasi dan role `admin` bila ada di `adminEmails`.
  - callback: `state` tidak cocok → redirect `/login?error=STATE`. `aud` salah → `error=TOKEN`. `email_verified:false` → `error=TOKEN`. Domain di luar UGM → `error=EMAIL_NOT_ALLOWED`. Sukses → cookie `singgah_sid` dan redirect `/`.
  - POST `/auth/logout` dengan `content-type: text/plain` → 415.
  - `clientIp`: header dari 100.68.122.86 dipercaya, header dari IP lain diabaikan.
- [ ] **Step 2:** Jalankan `npm test -w backend`. Harus FAIL.
- [ ] **Step 3:** Implementasikan sesuai Interfaces. Sesi = 32 byte `randomBytes` hex di tabel `sessions`.
- [ ] **Step 4:** Jalankan test dan typecheck. Harus PASS.
- [ ] **Step 5:** Commit `feat(api): sesi, login Google, test-login loopback`.

### Task 5: API lease untuk pemohon

**Files:**
- Create: `backend/src/api/leases.ts`
- Test: `backend/test/leases.test.ts`

**Interfaces:**
- Consumes: `checkLeaseRequest`, `allocateIp`, `usedMinutesToday`, `allowedDurations`, `nextWibMidnight`, `generateKeyPair`, `clientConfig`, `requireUser`, `clientIp`.
- Produces:
  - `GET /api/labs` → `LabOption[]` (hanya aktif, `durations` dari `allowedDurations`). `GET /api/me` ditambah `quotaMinutesLeft` dan `quotaResetsAt`.
  - `POST /api/leases {labId: string, minutes: number}` → 201 `IssueResponse` (`config`, `filename: "singgah-<labId>.conf"`), atau `ApiError` dengan status dari `Rejection`. Insert lease, alokasi IP, dan audit `ISSUED` (detail: email, tunnelIp, labId, minutes, requesterIp) dalam **satu transaksi**. Pelanggaran unik `user_id` → 409 `HAS_ACTIVE`. Pelanggaran `tunnel_ip` → coba alokasi ulang sekali, lalu 503 `POOL_FULL`.
  - `GET /api/leases/current` → `LeaseView | null` (`peerActive = installed_at != null`). Tidak pernah berisi private key atau config.
  - `POST /api/leases/:id/release` → 200. Hanya pemilik (lainnya 404). Status `REVOKED`, `revoked_at=now`, `revoked_by=email`, `reason='Dilepas pemohon'`, lalu audit `REVOKED`.

- [ ] **Step 1: Tulis test yang gagal:**
  - Pengajuan sah → 201, `config` mengandung `Address = 10.8.0.2/32` dan `AllowedIPs = 10.8.0.1/32, 192.168.20.0/24`. DB hanya menyimpan `client_pubkey`. Tidak ada kolom berisi private key: cek bahwa `JSON.stringify(semua baris leases+audit)` tidak mengandung private key dari respons.
  - **Klik ganda:** dua `inject` paralel (`Promise.all`) dari user yang sama → satu 201 dan satu 409 `HAS_ACTIVE`.
  - Lab nonaktif → 404. `minutes: 240` pada lab `max_hours=2` → 400. `minutes: 1` saat testMode false → 400. Kuota: sudah terpakai 450 menit → 429 dengan pesan memuat "00.00 WIB". Pool penuh (253 lease ACTIVE dari user lain) → 503.
  - `GET /api/leases/current` setelah terbit tidak mengandung `PrivateKey`.
  - release oleh user lain → 404. Oleh pemilik → status REVOKED dan audit `REVOKED` dengan actor = email. Setelah release, pengajuan baru → 201 dengan IP **berbeda** (IP lama belum `ended_at`).
  - Pengajuan lewat proxy (`remoteAddress` = trustedProxyIp, header `cf-connecting-ip: 36.1.2.3`) → audit ISSUED `requesterIp` = `36.1.2.3`.
- [ ] **Step 2:** Jalankan test. Harus FAIL.
- [ ] **Step 3:** Implementasikan `leases.ts`.
- [ ] **Step 4:** Jalankan test dan typecheck. Harus PASS.
- [ ] **Step 5:** Commit `feat(api): pengajuan, lihat, dan lepas lease`.

### Task 6: API admin

**Files:**
- Create: `backend/src/api/admin.ts`
- Test: `backend/test/admin.test.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `parseCidr`, `cidrOverlaps`, `RESERVED_CIDRS`.
- Produces:
  - `GET /api/admin/leases?status=ACTIVE|EXPIRED|REVOKED` → `AdminLease[]` (default ACTIVE, urut `expires_at`).
  - `POST /api/admin/leases/:id/revoke {reason}`. `reason` kosong atau hanya spasi → 400. Lease bukan ACTIVE → 409. Status REVOKED dengan `revoked_by=email admin`, lalu audit `REVOKED`.
  - `GET /api/admin/labs` (semua lab). `POST /api/admin/labs {id,name,targetCidr,maxHours}`: id cocok `^lab-[a-z0-9]{1,20}$` (§6), CIDR valid, tidak overlap dengan lab lain maupun `RESERVED_CIDRS`, maxHours ∈ {1,2,4}. Selain itu 400 dengan pesan Indonesia. `PATCH /api/admin/labs/:id {name?,maxHours?,isActive?}`, CIDR tidak bisa diubah.
  - `GET /api/admin/audit?ip=&email=&from=&to=` → `AuditEntry[]` (filter `ip`/`email` lewat `json_extract(detail,…)`, maksimal 500 baris, terbaru dulu).
  - `GET /api/admin/stats` → `Stats`. Throughput wg0 dihitung dari selisih dua bacaan `/sys/class/net/<wgInterface>/statistics/{rx,tx}_bytes` yang disimpan di memori. Bila file tidak ada → `null`.

- [ ] **Step 1: Tulis test yang gagal:**
  - Non-admin ke setiap rute admin → 403.
  - Revoke tanpa alasan → 400. Revoke sah → REVOKED dan audit dengan `reason`.
  - Tambah lab `192.168.40.0/24` → 201. `192.168.20.0/25` → 400 (overlap lab-cyber). `172.18.0.0/16` → 400 (Docker). id `Lab_X` → 400.
  - Nonaktifkan `lab-cyber` saat ada lease aktif → lease tetap ACTIVE, dan pengajuan baru ke lab itu → 404.
  - Audit `?ip=10.8.0.2` hanya mengembalikan entri IP itu. `from/to` membatasi waktu.
- [ ] **Step 2:** Jalankan test. Harus FAIL.
- [ ] **Step 3:** Implementasikan `admin.ts`.
- [ ] **Step 4:** Jalankan test dan typecheck. Harus PASS.
- [ ] **Step 5:** Commit `feat(api): rute admin (lease, lab, audit, statistik)`.

### Task 7: Worker rekonsiliasi

**Files:**
- Create: `backend/src/worker/{sys.ts,wgdump.ts,nft.ts,reconcile.ts,main.ts}`, `backend/src/cli/lease.ts`
- Test: `backend/test/wgdump.test.ts`, `backend/test/nft.test.ts`, `backend/test/reconcile.test.ts`

**Interfaces:**
- Produces:
  - `type Sys = { wgDump(): Promise<string>; wgSetPeer(pub: string, ip: string): Promise<void>; wgRemovePeer(pub: string): Promise<void>; nftListJson(): Promise<string>; nftApply(script: string): Promise<void> }`. `realSys(iface: string): Sys` memakai `execFile('wg', …)` dan `execFile('nft', ['-f','-'])` dengan stdin.
  - `parseWgDump(text: string): { publicKey: string; allowedIps: string[]; rx: number; tx: number }[]` (lewati baris pertama, kolom dipisah tab: pub, psk, endpoint, allowed-ips, handshake, rx, tx, keepalive).
  - `labSetName(labId: string): string`, `labsWithRule(nftJson: string): Set<string>` (mengenali rule lewat comment `singgah:<lab-id>`), `buildNftScript(labs: {id: string; target_cidr: string}[], desired: Map<string, string[]>, haveRule: Set<string>): string`. Untuk setiap lab: `add set ip s5gw <set> { type ipv4_addr; }`, `flush set ip s5gw <set>`, `add element …` (bila ada), dan `insert rule ip s5gw forward iifname "wg0" ip saddr @<set> ip daddr <cidr> accept comment "singgah:<id>"` bila belum ada di `haveRule`. Satu transaksi.
  - `reconcileOnce(db: DatabaseSync, sys: Sys, nowMs: number): Promise<{ installed: number; removed: number; closed: number; errors: string[] }>`. Langkahnya persis §7 (1–8). Byte: `delta = cur >= seen ? cur - seen : cur`, lalu `bytes += delta`, `seen = cur`. Saat peer dipasang, `seen = 0` dan `installed_at = now`.
  - `cli/lease.ts` (dijalankan root di laptop): `add --email <e> --lab <id> --pubkey <p> --minutes <n>` → mencetak `<leaseId> <ip>`, dan `revoke --id <n> --reason <r>`. Memakai fungsi alokasi dan audit yang sama dengan API (actor `selftest`).
  - `worker/main.ts`: `openDb(path,{migrate:false})` + `assertSchema` (bila gagal, exit 1 dan systemd mencoba lagi dengan `RestartSec=5`), lalu loop `reconcileOnce` setiap `reconcileIntervalS`. Log satu baris per siklus yang ada perubahan atau error, termasuk durasi siklus dalam ms (PRD 3.3). SIGTERM menunggu siklus berjalan selesai.

- [ ] **Step 1: Tulis test yang gagal** (Sys palsu yang menyimpan peer dan skrip nft di memori):
  - `parseWgDump` pada contoh dump dua peer menghasilkan rx/tx angka.
  - `buildNftScript` untuk `lab-cyber` dengan `['10.8.0.2']` dan `haveRule` kosong mengandung `flush set ip s5gw lab_cyber`, `add element ip s5gw lab_cyber { 10.8.0.2 }`, dan `comment "singgah:lab-cyber"`. Bila `haveRule` sudah memuat lab itu → tanpa `insert rule`.
  - Lease ACTIVE baru → `wgSetPeer(pub,'10.8.0.2')` dipanggil (`realSys` yang menambahkan `/32`) dan `installed_at` terisi.
  - Lease lewat `expires_at` dengan peer rx=100 tx=200 → byte tersimpan **sebelum** `wgRemovePeer` (urutan panggilan dicatat Sys palsu), status EXPIRED, `ended_at` terisi, audit `EXPIRED` berisi `bytesRx:100, bytesTx:200`.
  - Lease REVOKED → peer dilepas, `ended_at` terisi, audit `CLOSED` dengan byte. Status tetap REVOKED.
  - Peer yatim (tanpa lease) → `wgRemovePeer`. Tidak ada perubahan DB.
  - Counter reset: `seen=500, bytes=500`, dump baru rx=50 → bytes 550.
  - `wgSetPeer` gagal untuk satu lease → lease lain tetap terpasang, `errors.length === 1`, dan siklus berikutnya mencoba lagi.
  - **wg0 hilang:** `wgDump` throw → `errors` berisi pesan, tidak ada baris DB yang berubah (bandingkan snapshot tabel).
  - **s5gw hilang:** `nftListJson` throw → tidak ada lease yang ditutup pada siklus itu.
  - REVOKED tanpa peer terpasang (setelah reboot) → langsung ditutup (`ended_at`, audit `CLOSED` dengan byte terakhir yang tersimpan).
- [ ] **Step 2:** Jalankan test. Harus FAIL.
- [ ] **Step 3:** Implementasikan modul worker dan CLI.
- [ ] **Step 4:** Jalankan test dan typecheck. Harus PASS.
- [ ] **Step 5:** Commit `feat(worker): rekonsiliasi wg0 dan nftables dari database`.

### Task 8: Pemasangan di laptop

**Files:**
- Modify: `infra/laptop/s5-labs` (hapus pembuatan set dan aturan per lab; tambahkan aturan port API di chain input)
- Create: `infra/laptop/{singgah-api.service,singgah-worker.service,singgah.env.example,install.sh,deploy.sh}`, isi `README.md`

**Interfaces:**
- Consumes: `backend/src/api/main.ts`, `backend/src/worker/main.ts`.
- Produces:
  - Chain input `s5gw` dari `s5-labs` mendapat tiga aturan: `tcp dport 8780 iifname "lo" accept`, `tcp dport 8780 ip saddr 100.68.122.86 accept`, `tcp dport 8780 drop`. Variabel `LABS` tetap ada, tapi hanya untuk netns. Kerangka chain forward = established accept, `iifname "wg0" drop`, `oifname "wg0" drop`.
  - `install.sh` (sekali, root di laptop): pasang Node `v24.22.1` dari tarball resmi `nodejs.org/dist` ke `/opt/node-v24.22.1` (verifikasi dengan `SHASUMS256.txt`), buat user sistem `singgah`, `/var/lib/singgah` (singgah 0750), `/etc/singgah/singgah.env` dari contoh (0640 root:singgah), deploy key `/root/.ssh/singgah_deploy` dan entri `~/.ssh/config` host `github-singgah`, clone ke `/opt/singgah`, pasang unit, lalu `systemctl enable`. **Node sistem (v20) tidak disentuh.**
  - `deploy.sh`: `git -C /opt/singgah pull --ff-only` → `npm ci` → `npm run build -w frontend` (bila ada) → `install -m 755 infra/laptop/s5-labs /usr/local/sbin/` → `systemctl restart s5-labs singgah-worker singgah-api`.
  - `singgah-api.service`: `User=singgah`, `EnvironmentFile=/etc/singgah/singgah.env`, `ExecStart=/opt/node-v24.22.1/bin/node /opt/singgah/backend/src/api/main.ts`, `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ReadWritePaths=/var/lib/singgah`, `PrivateTmp=yes`, `CapabilityBoundingSet=` (kosong), `Restart=on-failure`.
  - `singgah-worker.service`: sama, tapi `ExecStart=…/worker/main.ts`, `AmbientCapabilities=CAP_NET_ADMIN`, `CapabilityBoundingSet=CAP_NET_ADMIN`, `After=wg-quick@wg0.service s5-labs.service`, `Wants=wg-quick@wg0.service`, tanpa `NoNewPrivileges` (tidak dibutuhkan untuk ambient caps).

- [ ] **Step 1:** Tambahkan deploy key read-only dari VPS: `gh repo deploy-key add <pub> -R Thinnur/singgah --title laptop-gateway`. Kunci dibuat oleh `install.sh` di laptop, lalu public key-nya diambil lewat ssh.
- [ ] **Step 2:** Jalankan `install.sh` di laptop dengan `TEST_MODE=1` dan `PUBLIC_URL=http://localhost:8780` di env.
- [ ] **Step 3: Verifikasi:**
  - `systemctl is-active singgah-api singgah-worker s5-labs` → tiga kali `active`.
  - `sudo nft list table ip s5gw` memuat `set lab_cloud/lab_cyber/lab_jarkom` dan tiga rule `comment "singgah:lab-…"` yang dibuat worker.
  - `curl -s localhost:8780/api/me` → 401.
  - Dari VPS `curl -m3 http://100.68.173.108:8780/api/me` → 401. Dari netns lab (`ip netns exec lab-cyber curl -m3 192.168.20.1:8780`) → timeout.
  - `sudo systemctl restart s5-labs` → dalam 10 detik set dan rule lab muncul lagi.
- [ ] **Step 4:** Commit `feat(infra): service singgah, install/deploy laptop, s5-labs tanpa set lab`, lalu push. Tambahkan catatan ke memory project.

### Task 9: Frontend

**Files:**
- Create: semua file `frontend/` di File Structure
- Modify: `backend/src/api/app.ts` (sajikan `frontend/dist` dengan SPA fallback untuk path non-`/api` non-`/auth`)
- Test: `frontend/src/lib/time.test.ts`, `backend/test/static.test.ts`

**Interfaces:**
- Consumes: tipe dari `backend/src/api/types.ts` (import type relatif), semua rute Task 4–6.
- Produces:
  - `api.ts`: `api<T>(method, path, body?) → Promise<T>`, selalu `content-type: application/json`. Kalau bukan 2xx, melempar `ApiError`. Kalau 401, mengarahkan ke `/login`.
  - `lib/time.ts`: `formatRemaining(ms: number): string` → `"1:59:59"` / `"0:00:59"` / `"0:00:00"` (tidak pernah negatif). `formatBytes(n: number): string` → `"1,5 MB"` (format id-ID).
  - Halaman Login: tombol "Masuk dengan Google" (link ke `/auth/login`). Bila ada `?error=EMAIL_NOT_ALLOWED`, tampilkan "Gunakan akun @mail.ugm.ac.id atau @ugm.ac.id". Bila `STATE`/`TOKEN`, tampilkan "Login gagal, coba lagi".
  - Rute: `/login`, `/` (dashboard bila ada lease aktif, selain itu form Ajukan), `/hasil` (state dari navigasi, bukan storage), `/admin/leases`, `/admin/labs`, `/admin/audit`, `/admin/stats` (menu admin hanya bila `role === 'admin'`).
  - Halaman Hasil: unduh `.conf` lewat `Blob`, QR lewat `qrcode.toDataURL(config)`, dan teks peringatan: "Konfigurasi ini hanya ditampilkan sekali. Kalau hilang, lepas lease lalu ajukan lagi." Config hanya disimpan di state React, tidak pernah di `localStorage`/`sessionStorage`.
  - Dashboard: hitung mundur (`setInterval` 1 detik), status "Menunggu gateway…" sampai `peerActive`, byte (label "Diunggah"/"Diunduh" = `bytesRx`/`bytesTx`), tombol "Lepas Lease" dengan konfirmasi. Polling `GET /api/leases/current` setiap 5 detik. Saat lease habis, kembali ke form.
  - Form Ajukan: pilihan durasi berasal dari `LabOption.durations`. Durasi yang melebihi `quotaMinutesLeft` dinonaktifkan. Pesan `ApiError.message` ditampilkan apa adanya.

- [ ] **Step 1: Tulis test yang gagal:**
  - `time.test.ts`: `formatRemaining(7199000)` → `"1:59:59"`, `formatRemaining(-5)` → `"0:00:00"`, `formatBytes(1536000)` → `"1,5 MB"`.
  - `static.test.ts`: dengan `staticDir` berisi `index.html`, `GET /admin/labs` → 200 `text/html`, sedangkan `GET /api/tidak-ada` → 404 JSON.
- [ ] **Step 2:** Jalankan `npm test`. Harus FAIL.
- [ ] **Step 3:** Implementasikan frontend dan static serving. Gaya visual bebas (Tailwind), tapi harus rapi di lebar 360 px.
- [ ] **Step 4:** Jalankan `npm test && npm run typecheck && npm run build -w frontend`. Harus PASS.
- [ ] **Step 5: Verifikasi visual.**
  - Deploy ke laptop (`deploy.sh`), buka tunnel `ssh -L 8780:127.0.0.1:8780 laptop-s5`, lalu di VPS gunakan `playwright-cli` dengan config Chromium bawaan.
  - Langkah: buka `http://localhost:8780/login`, lalu jalankan `fetch('/auth/test-login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@mail.ugm.ac.id'})})` dari konteks halaman. Laptop melihat permintaan ini dari loopback lewat tunnel SSH, jadi cookie langsung terpasang. Setelah itu ajukan lab-cyber 1 menit dan pastikan halaman Hasil menampilkan QR. Email itu harus ada di `ADMIN_EMAILS` env uji.
  - Screenshot di lebar 360 px dan 1280 px: halaman Ajukan, Hasil, Dashboard, Admin Leases. Kirim ke pengguna.
- [ ] **Step 6:** Commit `feat(frontend): portal Singgah (pemohon + admin)`, lalu push.

### Task 10: Self-test baru dan uji integrasi di laptop

**Files:**
- Modify: `infra/laptop/s5-selftest`

**Interfaces:**
- Consumes: `cli/lease.ts` (`add`/`revoke`), API di `127.0.0.1:8780` (mode `--api` butuh `TEST_MODE=1`).
- Produces: `sudo s5-selftest` (selalu bisa dijalankan) dan `sudo s5-selftest --api` (alur API). Keluaran `PASS/FAIL` per cek, exit 0 hanya bila semua lulus. Pola peer netns tetap sama seperti versi sekarang (socket lahir di netns utama, endpoint relay, `ENDPOINT` bisa di-override).

- [ ] **Step 1:** Ubah `s5-selftest`:
  - Peer uji dibuat dengan `node /opt/singgah/backend/src/cli/lease.ts add --email selftest@local …` (user `selftest@local` dibuat oleh CLI bila belum ada, dan CLI melewati cek domain).
  - Tunggu sampai `wg show wg0` memuat pubkey-nya (≤ 6 detik), lalu jalankan 10 cek segmentasi yang sama.
  - Cleanup lewat `revoke` dan pastikan peer hilang ≤ 6 detik.
- [ ] **Step 2:** Tambahkan mode `--api`:
  1. test-login + `POST /api/leases` lab-cyber 60 menit → peer aktif ≤ 5 detik dan ping `192.168.20.10` lewat netns berhasil.
  2. Release → peer dan elemen nft hilang ≤ 6 detik, audit `REVOKED` + `CLOSED` dengan byte > 0.
  3. Lease 1 menit → hilang ≤ 30 detik setelah `expiresAt`, audit `EXPIRED`.
  4. `systemctl restart wg-quick@wg0 s5-labs` dengan satu lease aktif → peer dan set pulih ≤ 10 detik.
  5. `wg set wg0 peer <acak> allowed-ips 10.8.0.250/32` → hilang ≤ 6 detik.
- [ ] **Step 3: Verifikasi.** Jalankan `deploy.sh`, lalu `sudo s5-selftest` dan `sudo s5-selftest --api`. Keduanya harus `SEMUA LULUS`.
- [ ] **Step 4:** Commit `test(infra): s5-selftest lewat database + mode --api`, lalu push.

### Task 11: Go-live (bergantung pada langkah pengguna)

**Files:**
- Modify: `/etc/singgah/singgah.env` di laptop (bukan repo), `README.md`

- [ ] **Step 1:** Minta pengguna melakukan tiga hal (§10):
  1. Public Hostname `singgah.akzara.id` → `http://100.68.173.108:8780` di tunnel Cloudflare.
  2. OAuth Client dengan redirect `https://singgah.akzara.id/auth/callback`.
  3. Isi `ADMIN_EMAILS`/`EXTRA_ALLOWED_EMAILS`.

  Juga minta izin pemilik laptop untuk reboot. **Berhenti sampai semuanya tersedia.**
- [ ] **Step 2:** Isi env (`PUBLIC_URL=https://singgah.akzara.id`, kredensial Google, `TEST_MODE` sesuai keputusan pengguna), lalu `systemctl restart singgah-api`.
- [ ] **Step 3: Verifikasi.**
  - `curl -sI https://singgah.akzara.id/` → 200.
  - Login sungguhan dengan akun `@mail.ugm.ac.id` dari pengguna. Catat bila diblokir Workspace, lalu uji jalur `EXTRA_ALLOWED_EMAILS`.
  - Ajukan lease dari HP, scan QR, buka `http://192.168.20.10` (butuh `s5-lab-web` sementara, atau layanan lab permanen bila diminta).
- [ ] **Step 4:** Reboot laptop (dengan izin). Setelah naik, `sudo s5-selftest` harus `SEMUA LULUS` dan lease aktif pulih.
- [ ] **Step 5:** Perbarui README (alamat, langkah admin) dan memory project. Commit dan push.
