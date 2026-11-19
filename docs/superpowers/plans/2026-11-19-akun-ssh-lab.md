# Akun SSH di Container Lab — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mahasiswa bisa mengajukan akun SSH per lab. Setelah admin menyetujui, mahasiswa membuat password sekali-tampil dan bisa SSH ke container lab di `192.168.<x>.10` lewat tunnel.

**Architecture:** Database adalah sumber kebenaran. API mengubah status akun dan menyimpan hash password (sha512-crypt lewat `openssl`). Worker yang sudah ada menulis berkas `accounts` per lab ke `/var/lib/singgah/labs/<lab-id>/`. Container lab per lab (dijalankan `s5-labs`, disambungkan ke netns `lab-<id>` lewat `ip netns attach`) me-mount direktori itu read-only, lalu skrip di dalamnya menyinkronkan user Linux. API dan worker tidak pernah menyentuh Docker.

**Tech Stack:** Node 24 + TypeScript (dijalankan langsung, tanpa build), `node:sqlite`, Fastify 5, `node:test`. React 19 + Vite + Tailwind 4. Bash, Docker 29 (Debian trixie-slim), iproute2 6.19, OpenSSH.

**Spec:** `docs/superpowers/specs/2026-11-19-akun-ssh-lab-design.md`

## Global Constraints

- Tidak menambah dependensi npm.
- Semua teks yang tampil ke pengguna dan pesan error API berbahasa Indonesia. Kode, nama, dan komentar mengikuti gaya repo.
- Waktu dalam epoch milidetik. Error API berupa `HttpError(status, CODE, pesan)`.
- Password asli tidak boleh tersimpan atau tercatat di database, berkas, log, atau argv. Pengecualian: argv CLI selftest untuk password uji sekali pakai.
- API dan worker tetap berjalan sebagai user `singgah` tanpa root dan tanpa akses Docker socket.
- Jangan pernah menjalankan `nft flush ruleset`. Jangan mengubah aturan Docker, k3s, atau Tailscale, kecuali dua aturan `DOCKER-USER` yang sudah dipasang `s5-labs`.
- Username: `^[a-z][a-z0-9]{0,31}$`. uid = `10000 + users.id`, dan rentang uid akun lab 10000–59999.
- Container: nama `s5-lab-<id>`, image `singgah-lab-ssh`, hostname `lab-<id>`. Berkas akun di `/var/lib/singgah/labs/lab-<id>/accounts`, home di `/var/lib/singgah-labs/lab-<id>/home`, host key di `/var/lib/singgah-labs/lab-<id>/hostkeys`.
- Akun aktif dalam 10 detik setelah password dibuat. Setelah dicabut, login ditolak dan sesi diputus dalam 10 detik.
- Kerjakan di branch `feat/akun-ssh`. Commit per task dengan pesan `feat(<area>): ...` berbahasa Indonesia, diakhiri `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push dan merge ke `main` hanya atas izin pemilik.
- Tes backend: `cd backend && npm test`. Typecheck: `npm run typecheck` dari root.

## Review Focus

1. **Bagian depan email yang aneh**: titik, plus, diawali angka, sangat panjang, atau seluruhnya simbol. Hasilnya harus selalu username valid dan unik. Ditangani di Task 2 (`sshUsernameFor`).
2. **Dua orang dengan bagian depan email yang menjadi sama** setelah dinormalisasi (`budi.s@mail.ugm.ac.id` dan `budis@ugm.ac.id`). Orang kedua mendapat `budis2`, dan username orang pertama tidak pernah berubah. Ditangani di Task 2 dan Task 3.
3. **Klik ganda pada "Ajukan"** (dua request bersamaan). Hasilnya harus tepat satu PENDING, dan request lainnya mendapat 409. Ditangani di Task 4.
4. **Admin memproses pengajuan yang sudah berubah** (menyetujui yang sudah ditolak, atau mencabut yang masih menunggu). Hasilnya 409 dengan pesan jelas, tanpa perubahan data. Ditangani di Task 4.
5. **Container dibuat ulang** (restart `s5-labs`, deploy, atau reboot). Akun kembali dengan uid yang sama dan pemilik home yang sama, host key tidak berubah, dan klien tidak mendapat peringatan. Ditangani di Task 7 (`test-image.sh`).

---

### Task 1: Skema database v2

**Files:**
- Modify: `backend/src/db.ts`
- Test: `backend/test/db.test.ts`

**Interfaces:**
- Produces: `SCHEMA_VERSION = 2`, ekspor `SCHEMA_V1` (untuk tes migrasi), tabel `ssh_accounts`, `ssh_audit`, dan kolom `users.ssh_username`.

- [ ] **Step 1: Tulis tes yang gagal** di `db.test.ts`, lalu ubah `assert.equal(SCHEMA_VERSION, 1)` menjadi `2`.

```ts
test('v2: one PENDING/APPROVED ssh account per (user, lab); reopen after REJECTED', () => {
  const { t, db } = setup();
  const ins = (st: string, lab = 'lab-cyber') =>
    db.prepare('INSERT INTO ssh_accounts(user_id,lab_id,status,requested_at) VALUES(1,?,?,0)').run(lab, st);
  ins('PENDING');
  assert.throws(() => ins('APPROVED'), /UNIQUE/);
  ins('PENDING', 'lab-cloud');
  db.exec(`UPDATE ssh_accounts SET status='REJECTED' WHERE lab_id='lab-cyber'`);
  ins('PENDING');
  assert.throws(() => ins('BOGUS', 'lab-jarkom'), /CHECK/);
  db.close(); t.cleanup();
});
test('v2: users.ssh_username unique when set', () => {
  const { t, db } = setup();
  db.exec(`UPDATE users SET ssh_username='budi' WHERE id=1`);
  assert.throws(() => db.exec(`UPDATE users SET ssh_username='budi' WHERE id=2`), /UNIQUE/);
  db.close(); t.cleanup();
});
test('ssh_audit is append-only', () => {
  const { t, db } = setup();
  db.exec(`INSERT INTO ssh_audit(account_id,action,actor,at,detail) VALUES (1,'REQUESTED','a',1,'{}')`);
  assert.throws(() => db.exec(`UPDATE ssh_audit SET actor='x'`), /append-only/);
  assert.throws(() => db.exec(`DELETE FROM ssh_audit`), /append-only/);
  db.close(); t.cleanup();
});
test('migrates a v1 database to v2 keeping rows', () => {
  const t = tmpDb();
  const v1 = new DatabaseSync(t.file);
  v1.exec(SCHEMA_V1); v1.exec('PRAGMA user_version = 1');
  v1.exec(`INSERT INTO users(email,role,created_at) VALUES ('a@ugm.ac.id','student',0)`); v1.close();
  const db = openDb(t.file);
  assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 2);
  assert.equal(db.prepare('SELECT count(*) c FROM users').get()!.c, 1);
  assert.equal(db.prepare('SELECT count(*) c FROM ssh_accounts').get()!.c, 0);
  db.close(); t.cleanup();
});
```

- [ ] **Step 2: Jalankan tes dan pastikan gagal.** Perintah: `cd backend && npm test -- test/db.test.ts`. Hasil yang diharapkan: FAIL (tabel `ssh_accounts` tidak ada, `SCHEMA_V1` tidak diekspor).

- [ ] **Step 3: Implementasikan.** Ekspor `SCHEMA_V1`. Tambahkan `SCHEMA_V2`:
  - `ALTER TABLE users ADD COLUMN ssh_username TEXT`, ditambah `CREATE UNIQUE INDEX users_ssh_username ON users(ssh_username) WHERE ssh_username IS NOT NULL`.
  - `ssh_accounts(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), lab_id TEXT NOT NULL REFERENCES labs(id), status TEXT NOT NULL CHECK(status IN ('PENDING','APPROVED','REJECTED','REVOKED')), requested_at INTEGER NOT NULL, decided_at INTEGER, decided_by TEXT, reason TEXT, password_hash TEXT, password_set_at INTEGER)`, dengan indeks unik parsial `ssh_accounts_one_open ON ssh_accounts(user_id, lab_id) WHERE status IN ('PENDING','APPROVED')`.
  - `ssh_audit(id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, action TEXT NOT NULL CHECK(action IN ('REQUESTED','APPROVED','REJECTED','REVOKED','PASSWORD_SET')), actor TEXT NOT NULL, at INTEGER NOT NULL, detail TEXT NOT NULL)`, dengan dua trigger append-only seperti `audit_log` (pesan `'ssh_audit append-only'`).
  - `migrate()`: terapkan v1 bila `<1`, lalu v2 bila `<2`, dalam satu `BEGIN IMMEDIATE`. Setelah itu set `user_version = SCHEMA_VERSION`.

- [ ] **Step 4: Jalankan semua tes backend dan pastikan lulus.** Perintah: `cd backend && npm test`. Hasil yang diharapkan: semua PASS.

- [ ] **Step 5: Commit** `feat(db): skema v2 untuk akun SSH lab dan jejak auditnya`.

### Task 2: Username dan password

**Files:**
- Create: `backend/src/sshcred.ts`
- Test: `backend/test/sshcred.test.ts`

**Interfaces:**
- Produces:
  - `SSH_USERNAME: RegExp` = `/^[a-z][a-z0-9]{0,31}$/`
  - `SHA512_CRYPT: RegExp` = `/^\$6\$[./0-9A-Za-z]{1,16}\$[./0-9A-Za-z]{86}$/`
  - `RESERVED_USERNAMES: ReadonlySet<string>`
  - `sshUsernameFor(email: string, isTaken: (name: string) => boolean): string`
  - `generatePassword(): string`
  - `hashPassword(pw: string): Promise<string>`

- [ ] **Step 1: Tulis tes yang gagal.**

```ts
const none = () => false;
test('sshUsernameFor normalises the local part', () => {
  assert.equal(sshUsernameFor('Budi.Santoso@mail.ugm.ac.id', none), 'budisantoso');
  assert.equal(sshUsernameFor('22.123+lab@ugm.ac.id', none), 'u22123lab');
  assert.equal(sshUsernameFor('...@ugm.ac.id', none), 'user');
  assert.equal(sshUsernameFor(`${'a'.repeat(40)}@ugm.ac.id`, none), 'a'.repeat(28));
});
test('sshUsernameFor skips reserved and taken names', () => {
  assert.equal(sshUsernameFor('root@ugm.ac.id', none), 'root2');
  assert.equal(sshUsernameFor('budis@ugm.ac.id', (n) => n === 'budis' || n === 'budis2'), 'budis3');
  for (const r of ['root', 'sshd', 'nobody', 'admin', 'ubuntu', 'singgah']) assert.ok(RESERVED_USERNAMES.has(r));
});
test('every derived username matches SSH_USERNAME', () => {
  for (const e of ['A@x', '9@x', 'x.y-z_w@x', `${'9'.repeat(50)}@x`, '@x']) assert.match(sshUsernameFor(e, none), SSH_USERNAME);
});
test('generatePassword: 16 chars of a 32-symbol alphabet in 4 groups, no repeats', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) { const p = generatePassword(); assert.match(p, /^[a-kmnp-z2-9]{4}(-[a-kmnp-z2-9]{4}){3}$/); seen.add(p); }
  assert.equal(seen.size, 200);
});
test('hashPassword: sha512-crypt that openssl verifies with the same salt', async () => {
  const h = await hashPassword('abcd-efgh-ijkm-npqr');
  assert.match(h, SHA512_CRYPT);
  const salt = h.split('$')[2];
  const again = execFileSync('openssl', ['passwd', '-6', '-salt', salt, '-stdin'], { input: 'abcd-efgh-ijkm-npqr', encoding: 'utf8' }).trim();
  assert.equal(again, h);
  assert.notEqual(await hashPassword('abcd-efgh-ijkm-npqr'), h); // random salt
});
```

- [ ] **Step 2: Jalankan tes dan pastikan gagal.** Perintah: `cd backend && npm test -- test/sshcred.test.ts`. Hasil yang diharapkan: FAIL (modul belum ada).

- [ ] **Step 3: Implementasikan di `sshcred.ts`.**
  - `sshUsernameFor`: ambil bagian sebelum `@`, ubah ke huruf kecil, dan buang karakter selain `[a-z0-9]`. Kosong menjadi `user`. Diawali angka mendapat awalan `u`. Potong menjadi 28 karakter (sisa 4 karakter untuk sufiks). Bila nama terlarang atau `isTaken`, tambahkan 2, 3, dan seterusnya.
  - `RESERVED_USERNAMES` minimal: root, daemon, bin, sys, sync, games, man, lp, mail, news, uucp, proxy, backup, list, irc, nobody, sshd, messagebus, systemd, admin, administrator, ubuntu, debian, singgah, operator, guest, test.
  - `generatePassword`: alfabet `abcdefghijkmnpqrstuvwxyz23456789` (32 simbol, sehingga 16 karakter = 80 bit) diambil dengan `crypto.randomInt`, dikelompokkan 4-4 dengan `-`.
  - `hashPassword`: `execFile('openssl', ['passwd', '-6', '-stdin'])`. Password ditulis ke stdin, bukan argv. Kembalikan stdout yang sudah di-trim. Throw bila hasilnya tidak cocok dengan `SHA512_CRYPT`. Pesan error tidak boleh memuat password.

- [ ] **Step 4: Jalankan tes dan pastikan lulus.** Perintah sama dengan Step 2. Hasil yang diharapkan: PASS.

- [ ] **Step 5: Commit** `feat(backend): username SSH dari email, pembuat password, dan hash sha512-crypt`.

### Task 3: Penyimpanan akun SSH (transisi status, audit, isi berkas akun)

**Files:**
- Create: `backend/src/sshstore.ts`
- Test: `backend/test/sshstore.test.ts`

**Interfaces:**
- Consumes: `tx` (dari `leasestore.ts`), serta `sshUsernameFor`, `SSH_USERNAME`, dan `SHA512_CRYPT` (dari Task 2).
- Produces:
  - `type SshStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED'`
  - `SSH_UID_BASE = 10000`
  - `class SshStateError extends Error { code: 'ALREADY_OPEN' | 'NOT_PENDING' | 'NOT_APPROVED' | 'LAB_UNAVAILABLE' }`
  - `requestSsh(db, p: { userId: number; labId: string; actor: string; nowMs: number }): { id: number; username: string }`
  - `decideSsh(db, p: { id: number; approve: boolean; by: string; reason: string | null; nowMs: number }): void`
  - `revokeSsh(db, p: { id: number; by: string; reason: string; nowMs: number }): void`
  - `setSshPasswordHash(db, p: { id: number; hash: string; actor: string; nowMs: number }): void` (pemanggil yang memeriksa kepemilikan)
  - `labAccountsFile(db, labId: string): string`

- [ ] **Step 1: Tulis tes yang gagal.** Pakai DB sementara seperti `db.test.ts` dan `HASH = '$6$saltsalt$' + 'a'.repeat(86)`.

```ts
test('request: PENDING, username from email kept across labs, audit REQUESTED', () => {
  const r1 = requestSsh(db, { userId: budi, labId: 'lab-cyber', actor: 'budi.santoso@mail.ugm.ac.id', nowMs: 1 });
  assert.equal(r1.username, 'budisantoso');
  assert.equal(requestSsh(db, { userId: budi, labId: 'lab-cloud', actor: 'x', nowMs: 2 }).username, 'budisantoso');
  assert.throws(() => requestSsh(db, { userId: budi, labId: 'lab-cyber', actor: 'x', nowMs: 3 }), { code: 'ALREADY_OPEN' });
  assert.deepEqual(auditActions(r1.id), ['REQUESTED']);
});
test('colliding local parts get distinct names; first keeps its own', () => {
  // budi.s@mail.ugm.ac.id requests first -> 'budis'; budis@ugm.ac.id -> 'budis2'
});
test('request on inactive or unknown lab -> LAB_UNAVAILABLE', () => { /* UPDATE labs SET is_active=0 ... */ });
test('decide only from PENDING; reapply allowed after REJECTED', () => {
  // approve -> APPROVED with decided_by/decided_at; decide again -> NOT_PENDING
  // reject (other lab, reason 'Belum ambil matkul') -> REJECTED, reason stored; requestSsh again -> new PENDING row
});
test('revoke only from APPROVED and clears password_hash', () => {
  // revoke on PENDING -> NOT_APPROVED; approved+hash -> revoke -> status REVOKED, password_hash NULL, audit REVOKED
});
test('setSshPasswordHash only on APPROVED; audit has no hash', () => {
  // PENDING -> NOT_APPROVED; APPROVED -> password_hash = HASH, password_set_at = now
  // every ssh_audit.detail: assert.ok(!detail.includes('$6$'))
});
test('labAccountsFile lists APPROVED accounts of that lab only, skips tampered rows', () => {
  // approved+hash -> 'budisantoso:10001:' + HASH + '\n'; approved without hash -> 'name:uid:\n'
  // PENDING/REJECTED/REVOKED and other labs absent; lines sorted by username
  // UPDATE users SET ssh_username='root;x' for an approved user -> that line absent
  // password_hash 'plaintext' -> that line absent
  // no approved accounts -> ''
});
```

- [ ] **Step 2: Jalankan tes dan pastikan gagal.** Perintah: `cd backend && npm test -- test/sshstore.test.ts`. Hasil yang diharapkan: FAIL.

- [ ] **Step 3: Implementasikan.** Setiap fungsi tulis memakai `tx`.
  - **Transisi status** memakai `UPDATE ... WHERE id=? AND status=?`. Bila `changes===0`, throw `SshStateError`.
  - **`requestSsh`**:
    - Periksa lab ada dan `is_active=1`. Bila tidak, throw `LAB_UNAVAILABLE`.
    - Bila `users.ssh_username` NULL, isi lewat `sshUsernameFor(email, name => exists)`.
    - INSERT PENDING. Bila gagal karena UNIQUE `ssh_accounts`, throw `ALREADY_OPEN`.
  - **Detail audit** (JSON) berisi `{ email, username, labId }`, ditambah `reason` bila ada. Hash tidak pernah dimasukkan.
  - **`revokeSsh`** mengosongkan `password_hash` (diset NULL).
  - **Baris berkas akun**: `${username}:${SSH_UID_BASE + userId}:${hash ?? ''}\n`, diurutkan menurut username. Baris yang username-nya tidak cocok `SSH_USERNAME`, atau hash-nya tidak NULL dan tidak cocok `SHA512_CRYPT`, dilewati.

- [ ] **Step 4: Jalankan tes dan pastikan lulus.** Perintah: `cd backend && npm test`. Hasil yang diharapkan: semua PASS.

- [ ] **Step 5: Commit** `feat(backend): penyimpanan akun SSH, transisi status, dan isi berkas akun lab`.

### Task 4: API akun SSH

**Files:**
- Create: `backend/src/api/ssh.ts`
- Modify: `backend/src/api/types.ts`, `backend/src/api/app.ts` (daftarkan `sshRoutes(app)`)
- Test: `backend/test/ssh.test.ts` (salin `setup()` dari `admin.test.ts`)

**Interfaces:**
- Consumes: Task 2 (`generatePassword`, `hashPassword`) dan Task 3 (semua ekspor).
- Produces (ditambahkan ke `types.ts`, dipakai frontend):

```ts
export type SshStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';
export type SshLabView = {
  labId: string; labName: string; host: string;
  account: { id: number; status: SshStatus; username: string; reason: string | null;
             requestedAt: number; decidedAt: number | null; passwordSet: boolean } | null;
};
export type SshPasswordResponse = { username: string; host: string; password: string };
export type AdminSshAccount = {
  id: number; email: string; username: string; labId: string; labName: string; status: SshStatus;
  requestedAt: number; decidedAt: number | null; decidedBy: string | null; reason: string | null; passwordSet: boolean;
};
export type SshAuditEntry = {
  id: number; accountId: number; action: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'REVOKED' | 'PASSWORD_SET';
  actor: string; at: number; detail: Record<string, unknown>;
};
```

Route:

| Route | Siapa | Berhasil | Error |
|---|---|---|---|
| `GET /api/ssh` | user | `SshLabView[]`, hanya lab `is_active=1` urut id. `account` = baris terbaru (id terbesar) milik user di lab itu. `host` = alamat jaringan `target_cidr` + 10 | 401 |
| `POST /api/ssh` `{labId}` | user | 201 `SshLabView` lab itu | 400 `BAD_REQUEST`, 404 `LAB_UNAVAILABLE` "Lab sedang tidak tersedia", 409 `ALREADY_REQUESTED` "Kamu sudah punya pengajuan atau akun SSH di lab ini" |
| `POST /api/ssh/:id/password` | pemilik | 200 `SshPasswordResponse` | 404 `NOT_FOUND`, 409 `NOT_APPROVED` "Akun SSH belum disetujui atau sudah dicabut", 429 `TOO_SOON` "Tunggu sebentar sebelum membuat password lagi" bila `password_set_at` kurang dari 10 detik lalu |
| `GET /api/admin/ssh?status=` | admin | `AdminSshAccount[]`. Bawaan PENDING urut `requested_at` naik. Status lain urut `COALESCE(decided_at, requested_at)` turun, maksimal 500 | 400 status tidak dikenal |
| `POST /api/admin/ssh/:id/approve` | admin | `{ok:true}` | 404, 409 `NOT_PENDING` "Pengajuan ini sudah diproses" |
| `POST /api/admin/ssh/:id/reject` `{reason}` | admin | `{ok:true}` | 400 "Alasan wajib diisi", 404, 409 `NOT_PENDING` |
| `POST /api/admin/ssh/:id/revoke` `{reason}` | admin | `{ok:true}` | 400, 404, 409 `NOT_APPROVED` |
| `GET /api/admin/ssh/audit` | admin | `SshAuditEntry[]`, 500 terbaru | — |

- [ ] **Step 1: Tulis tes yang gagal.**

```ts
test('unauthenticated 401 on /api/ssh; student 403 on every admin ssh route', ...);
test('full flow: request -> approve -> password -> revoke', async () => {
  // POST /api/ssh {labId:'lab-cyber'} -> 201, account.status 'PENDING', username 's'
  // admin approve -> 200; GET /api/ssh -> lab-cyber account APPROVED, passwordSet false, host '192.168.20.10'
  // POST /api/ssh/:id/password -> 200 { username:'s', host:'192.168.20.10', password } ; password matches the generatePassword pattern
  // DB password_hash matches SHA512_CRYPT and does not contain the password
  // no ssh_audit.detail contains the password or '$6$'
  // admin revoke {reason:'Selesai praktikum'} -> 200; GET /api/ssh -> REVOKED with reason
});
test('two concurrent requests for one lab -> exactly one 201, one 409 ALREADY_REQUESTED', async () => {
  const [a, b] = await Promise.all([req(), req()]);
  assert.deepEqual([a.statusCode, b.statusCode].sort(), [201, 409]);
});
test('another student cannot make a password for my account -> 404', ...);
test('password twice within 10 s -> 429 TOO_SOON; after 10 s -> 200 and hash changes', ...); // move NOW
test('approve a rejected request -> 409 NOT_PENDING; revoke a pending one -> 409 NOT_APPROVED; data unchanged', ...);
test('reject/revoke with blank reason -> 400', ...);
test('inactive lab: POST -> 404 LAB_UNAVAILABLE and lab absent from GET /api/ssh', ...);
test('admin list: PENDING oldest first; ?status=BOGUS -> 400; audit lists REQUESTED/APPROVED/PASSWORD_SET', ...);
```

- [ ] **Step 2: Jalankan tes dan pastikan gagal.** Perintah: `cd backend && npm test -- test/ssh.test.ts`. Hasil yang diharapkan: FAIL (404 di semua route).

- [ ] **Step 3: Implementasikan `sshRoutes(app: FastifyInstance): void` di `api/ssh.ts`.** Petakan `SshStateError.code` ke tabel di atas. `labTargetIp(cidr: string): string` (lokal di berkas ini) memakai `parseCidr(cidr).net + 10`, lalu diubah ke notasi titik. Route admin juga ada di berkas ini dan memakai `requireAdmin`.

- [ ] **Step 4: Jalankan semua tes dan typecheck.** Perintah: `cd backend && npm test && cd .. && npm run typecheck`. Hasil yang diharapkan: semua PASS dan tidak ada error tipe.

- [ ] **Step 5: Commit** `feat(api): pengajuan, persetujuan, password, dan pencabutan akun SSH`.

### Task 5: Worker menulis berkas akun per lab

**Files:**
- Create: `backend/src/worker/accounts.ts`
- Modify: `backend/src/config.ts` (`labAccountsDir: string` dari `LAB_ACCOUNTS_DIR`, bawaan `/var/lib/singgah/labs`), `backend/src/worker/main.ts`, `infra/laptop/singgah.env.example` (baris contoh yang dikomentari)
- Test: `backend/test/accounts.test.ts`, `backend/test/config.test.ts` (tambahkan cek nilai bawaan)

**Interfaces:**
- Consumes: `labAccountsFile` (Task 3).
- Produces: `syncAccountFiles(db: DatabaseSync, dir: string): { written: string[]; errors: string[] }`.

- [ ] **Step 1: Tulis tes yang gagal.** Panggil `process.umask(0o027)` di awal, karena worker berjalan dengan `UMask=0027`.

```ts
test('writes <dir>/<lab>/accounts for every valid lab, mode 0644, only when changed', () => {
  // approve + set hash for one user on lab-cyber
  const r1 = syncAccountFiles(db, dir);
  assert.deepEqual(r1.written.sort(), ['lab-cloud', 'lab-cyber', 'lab-jarkom']);
  assert.equal(readFileSync(join(dir, 'lab-cyber', 'accounts'), 'utf8'), labAccountsFile(db, 'lab-cyber'));
  assert.equal(statSync(join(dir, 'lab-cyber', 'accounts')).mode & 0o777, 0o644);
  assert.equal(statSync(join(dir, 'lab-cyber')).mode & 0o777, 0o755);
  assert.deepEqual(syncAccountFiles(db, dir).written, []);
  // revokeSsh -> written ['lab-cyber'] and the file is ''
});
test('lab id with a path in it is skipped with an error, nothing written outside dir', () => {
  db.prepare(`INSERT INTO labs(id,name,target_cidr) VALUES('lab-a/../../x','x','192.168.50.0/24')`).run();
  const r = syncAccountFiles(db, dir);
  assert.equal(r.errors.length, 1);
  assert.ok(!existsSync(join(dir, '..', 'x')));
});
```

- [ ] **Step 2: Jalankan tes dan pastikan gagal.** Perintah: `cd backend && npm test -- test/accounts.test.ts`. Hasil yang diharapkan: FAIL.

- [ ] **Step 3: Implementasikan.**
  - Hanya lab dengan id yang cocok `^lab-[a-z0-9]{1,20}$` yang diproses.
  - Direktori dibuat dengan `mkdirSync(..., { recursive: true })`, lalu `chmodSync(0o755)`.
  - Isi dibandingkan dengan berkas yang ada. Bila berbeda: tulis `accounts.tmp`, `chmodSync(0o644)`, lalu `renameSync`. Mode diset eksplisit karena umask memotong mode `writeFileSync`. Kerahasiaan dijaga oleh induknya, `/var/lib/singgah` yang bermode 0750.
  - Error per lab ditangkap dan dimasukkan ke `errors`.
  - Di `main.ts`, panggil setelah `reconcileOnce` di setiap siklus. Catat `akun ssh ditulis: <lab,...>` hanya bila ada yang ditulis, dan catat error ke `console.error`.

- [ ] **Step 4: Jalankan semua tes dan pastikan lulus.** Perintah: `cd backend && npm test`. Hasil yang diharapkan: semua PASS.

- [ ] **Step 5: Commit** `feat(worker): tulis berkas akun SSH per lab tiap siklus`.

### Task 6: CLI selftest untuk akun SSH

**Files:**
- Modify: `backend/src/cli/lease.ts` (perintah dan komentar penggunaan di kepala berkas)
- Test: `backend/test/cli.test.ts`

**Interfaces:**
- Consumes: Task 2 dan Task 3.
- Produces (dipakai `s5-selftest`, Task 8):
  - `lease.ts ssh-grant --email <e> --lab <id> --password <p>` mencetak `<accountId> <username>`.
  - `lease.ts ssh-revoke --id <n> --reason <r>`.
  - Keduanya dengan aktor `selftest`.

- [ ] **Step 1: Tulis tes yang gagal.**

```ts
test('cli ssh-grant approves with a password hash; a second grant replaces the open account; ssh-revoke', () => {
  const g = run('ssh-grant', '--email', 'selftest1@local', '--lab', 'lab-cyber', '--password', 'abcd-efgh-ijkm-npqr');
  assert.equal(g.status, 0, g.stderr);
  assert.match(g.stdout, /^\d+ selftest1\n$/);
  // row APPROVED, password_hash matches SHA512_CRYPT
  const g2 = run('ssh-grant', '--email', 'selftest1@local', '--lab', 'lab-cyber', '--password', 'x');
  // new id; previous row REVOKED
  const r = run('ssh-revoke', '--id', id2, '--reason', 'selftest');
  assert.equal(r.status, 0, r.stderr); // row REVOKED
});
```

- [ ] **Step 2: Jalankan tes dan pastikan gagal.** Perintah: `cd backend && npm test -- test/cli.test.ts`. Hasil yang diharapkan: FAIL.

- [ ] **Step 3: Implementasikan.** Upsert user dengan cara yang sama seperti `add`. Bila masih ada akun PENDING atau APPROVED untuk (user, lab), cabut dulu dengan alasan `selftest`. Lalu jalankan `requestSsh`, `decideSsh(approve)`, `hashPassword`, dan `setSshPasswordHash`. Beri komentar bahwa `--password` di argv hanya untuk password uji sekali pakai.

- [ ] **Step 4: Jalankan semua tes dan pastikan lulus.** Perintah: `cd backend && npm test`. Hasil yang diharapkan: semua PASS.

- [ ] **Step 5: Commit** `feat(cli): ssh-grant dan ssh-revoke untuk selftest`.

### Task 7: Image container lab, sinkronisasi akun, dan `s5-labs`

**Files:**
- Create: `infra/laptop/lab-ssh/Dockerfile`, `infra/laptop/lab-ssh/entrypoint.sh`, `infra/laptop/lab-ssh/sync-accounts.sh`, `infra/laptop/lab-ssh/sshd-singgah.conf`, `infra/laptop/lab-ssh/test-image.sh`
- Modify: `infra/laptop/s5-labs`, `infra/laptop/s5-labs.service` (tambah `Wants=docker.service`), `infra/laptop/deploy.sh`, `README.md` (bagian container lab dan *shortcut* restart)

**Interfaces:**
- Consumes: format berkas akun dari Task 3/5 (`username:uid:hash`).
- Produces:
  - `s5-labs container-run <nama> <hostname> <dir akun> <dir home> <dir hostkeys>`. Ini satu-satunya tempat flag `docker run` didefinisikan, dipakai oleh `up` dan `test-image.sh`.
  - Image `singgah-lab-ssh`.

Ketentuan isi:
- **Dockerfile.** Basis `debian:trixie-slim`. Paket: `openssh-server`, `iproute2`, `iputils-ping`, `curl`, `nano`, `vim-tiny`, `less`, `procps`, `python3` (tanpa `sudo`). Host key bawaan dihapus (`rm /etc/ssh/ssh_host_*`). Buat `mkdir /run/sshd`. Tambahkan `/etc/motd` dua kalimat: container lab Singgah, dan hanya `/home` yang tersimpan saat container dibuat ulang. `ENTRYPOINT ["/usr/local/sbin/entrypoint.sh"]`.
- **`sshd-singgah.conf`** dipasang ke `/etc/ssh/sshd_config.d/singgah.conf`: `HostKey /etc/ssh/hostkeys/ssh_host_ed25519_key`, `PasswordAuthentication yes`, `KbdInteractiveAuthentication no`, `AuthorizedKeysFile none` (password satu-satunya cara masuk, supaya mencabut atau mengganti password selalu berlaku), `PermitRootLogin no`, `AllowTcpForwarding no`, `AllowStreamLocalForwarding no`, `AllowAgentForwarding no`, `X11Forwarding no`, `PermitTunnel no`, `GatewayPorts no`, `MaxAuthTries 3`, `LoginGraceTime 30`.
- **`entrypoint.sh`.** Bila `/etc/ssh/hostkeys/ssh_host_ed25519_key` belum ada, buat dengan `ssh-keygen -t ed25519 -N ''`. Jalankan `sync-accounts.sh --loop &`, lalu `exec /usr/sbin/sshd -D -e`.
- **`sync-accounts.sh`** (berjalan sebagai root container, membaca `/run/singgah/accounts`):
  - Berkas diperiksa tiap 2 detik. Sinkron dijalankan saat start dan setiap kali checksum berubah. Berkas yang tidak ada dianggap kosong.
  - Validasi tiap baris persis seperti spec 4.2. Baris tidak valid dicatat sebagai `baris N diabaikan: <alasan>`, tanpa mencetak hash.
  - Buat grup dan user dengan uid/gid yang sama: `useradd -M -u UID -g UID -s /bin/bash -d /home/NAME`.
  - Hash dipasang lewat **stdin** `chpasswd -e`. Hash kosong berarti dikunci dengan `!`. Jangan pernah lewat argv, karena `ps` terlihat oleh mahasiswa lain.
  - `/home/NAME` dibuat dengan mode 0700 dan pemilik UID bila belum ada.
  - User dengan uid 10000–59999 yang tidak ada di berkas: `pkill -KILL -u`, lalu `userdel` tanpa `-r`.
  - Bila nama atau uid bentrok dengan user lain, lewati dan catat.
- **Flag `container-run`:**
  - `docker run -d --init --restart no --network none --hostname <hostname> --name <nama>`
  - `--pids-limit 256 --memory 512m --cpus 1`
  - `--cap-drop ALL --cap-add CHOWN,DAC_OVERRIDE,FOWNER,SETUID,SETGID,SYS_CHROOT,KILL,AUDIT_WRITE,NET_BIND_SERVICE`. Builder boleh mengurangi atau menyesuaikan sampai `test-image.sh` lulus, tetapi tidak boleh menambah `SYS_ADMIN`, `NET_ADMIN`, atau `NET_RAW`.
  - `--security-opt no-new-privileges --sysctl net.ipv4.ping_group_range="0 2147483647"` (supaya user bisa ping tanpa `NET_RAW`)
  - `-v <dir akun>:/run/singgah:ro -v <dir home>:/home -v <dir hostkeys>:/etc/ssh/hostkeys singgah-lab-ssh`
- **`s5-labs up`**, per lab:
  - `install -d -o singgah -g singgah -m 0755 /var/lib/singgah/labs/lab-$id`
  - `install -d -m 0755 .../home`, `install -d -m 0700 .../hostkeys`
  - `ip link del`, `ip netns del`, `docker rm -f s5-lab-$id`
  - `container-run`, lalu `ip netns attach lab-$id <PID dari docker inspect>`
  - Langkah veth, alamat, dan route tetap seperti sekarang.
- **`s5-labs down`**: per lab `ip netns del` lalu `docker rm -f`.
- **`deploy.sh`**: sebelum blok restart, jalankan `command -v sshpass >/dev/null || apt-get install -y sshpass`, lalu `docker build -q -t singgah-lab-ssh infra/laptop/lab-ssh`.

- [ ] **Step 1: Tulis `test-image.sh`** (root di laptop, argumen: path ke `s5-labs` dan direktori `lab-ssh`). Skrip ini membangun image, memakai direktori sementara, dan menjalankan container uji `s5-lab-imgtest` lewat `s5-labs container-run`. Login diuji dari host dengan `nsenter -t <PID> -n sshpass -e ssh ... user@127.0.0.1`. Container uji selalu dihapus di akhir. Keluarannya baris `PASS` atau `FAIL` dan kode keluar 1 bila ada yang gagal. Cek:
  1. Baris valid `alice:10001:<hash 'pw-satu'>` ditambah tiga baris tidak valid (`root:0:<hash>`, `bob;x:10002:`, `carol:10003:bukanhash`). Dalam 6 detik: `id -u alice` = 10001, kolom shadow `alice` = hash, `/home/alice` bermode 0700 milik 10001, kolom shadow root tidak berubah, dan `id carol` gagal.
  2. Login `alice` dengan `pw-satu` menjalankan `hostname`, dan hasilnya sama dengan hostname uji. Password salah ditolak. Login root ditolak.
  3. `command -v sudo` gagal. Port forwarding ditolak: `ssh -N -L` keluar dengan error atau koneksi forward gagal.
  4. Dengan sesi `alice` yang sedang berjalan (`sleep 60`), baris `alice` dihapus. Dalam 6 detik: `id alice` gagal, sesinya mati, dan `/home/alice` masih ada.
  5. Container dibuat ulang dengan direktori yang sama dan `alice` kembali di berkas. Fingerprint host key sama dengan sebelumnya (`ssh-keyscan` lewat nsenter), `alice` login lagi, dan `/home/alice` tetap milik 10001.
- [ ] **Step 2: Salin ke laptop dan jalankan uji sebelum implementasi.** Perintah: `scp -r infra/laptop/lab-ssh infra/laptop/s5-labs laptop-s5:/tmp/s5-imgtest/` lalu `ssh laptop-s5 'sudo bash /tmp/s5-imgtest/lab-ssh/test-image.sh /tmp/s5-imgtest/s5-labs /tmp/s5-imgtest/lab-ssh'`. Hasil yang diharapkan: FAIL (Dockerfile atau `container-run` belum ada). Ini tidak menyentuh lab produksi.
- [ ] **Step 3: Implementasikan** Dockerfile, conf, entrypoint, sync, dan perubahan `s5-labs`, `s5-labs.service`, `deploy.sh`, serta README sesuai ketentuan di atas.
- [ ] **Step 4: Jalankan ulang Step 2, juga `bash -n` untuk semua skrip.** Hasil yang diharapkan: semua `PASS`, kode keluar 0. Lab produksi tidak tersentuh (`systemctl is-active s5-labs` tetap active, dan `docker ps` hanya menampilkan container produksi bila ada).
- [ ] **Step 5: Commit** `feat(infra): container SSH per lab dengan sinkron akun dan host key tetap`.

### Task 8: Cek SSH di `s5-selftest`

**Files:**
- Modify: `infra/laptop/s5-selftest`

**Interfaces:**
- Consumes: `lease ssh-grant`, `lease ssh-revoke` (Task 6), dan container lab (Task 7).

Ketentuan:
- Di `mode_db`, setelah cek peer 2 dan sebelum lease dicabut:
  - Buat `PW=$(openssl rand -hex 12)`, lalu jalankan `lease ssh-grant --email selftest1@local --lab lab-cyber --password "$PW"` dan simpan id serta username.
  - Catat id di `OPEN_SSH` supaya `cleanup` mencabutnya.
- Helper `sshn <n> <ip> <user> <perintah>`: `ip netns exec s5t<n> env SSHPASS="$PW" sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=4 -o PubkeyAuthentication=no -o PreferredAuthentications=password <user>@<ip> <perintah>`.
- Cek baru (format `ok`/`check` yang sama):
  - `waitfor 10 0.5` sampai `sshn 1 192.168.20.10 $U hostname` mencetak `lab-cyber`: "SSH peer 1 -> container lab cyber sebagai <U> (x dtk)"
  - blok "dari container: LAN rumah 192.168.1.1:80", lewat `sshn ... "timeout 3 bash -c '</dev/tcp/192.168.1.1/80'"`
  - blok "dari container: internet 1.1.1.1:443"
  - blok "dari container: sudo tersedia", lewat `command -v sudo`
  - blok "SSH dengan password salah"
  - blok "peer 2 (lease lab-cloud) -> SSH lab cyber .20.10:22", lewat `tcpn 2 192.168.20.10 22`
  - Setelah `lease ssh-revoke`: `waitfor 10 0.5` sampai login gagal: "akun SSH dicabut: login ditolak (x dtk)"
- Komentar kepala skrip menyebut cek SSH. Skrip memeriksa bahwa `sshpass` ada; bila tidak, `die` dengan petunjuk menjalankan `deploy.sh`.

- [ ] **Step 1: Implementasikan cek di atas.**
- [ ] **Step 2: Jalankan `bash -n infra/laptop/s5-selftest`.** Hasil yang diharapkan: tidak ada output. Pengujian sungguhan dilakukan di Task 10 setelah deploy.
- [ ] **Step 3: Commit** `feat(infra): s5-selftest menguji login SSH ke container lab dan pencabutannya`.

### Task 9: Frontend

**Files:**
- Create: `frontend/src/pages/SshAccounts.tsx`, `frontend/src/pages/AdminSsh.tsx`
- Modify: `frontend/src/api.ts` (ekspor ulang tipe baru), `frontend/src/pages/Home.tsx` (render `<SshAccounts />` di bawah dashboard atau form, selalu tampil), `frontend/src/main.tsx` (route `admin/ssh`), `frontend/src/Layout.tsx` (`NAV` + `['/admin/ssh', 'SSH']`), `frontend/src/pages/Legal.tsx` (bagian panduan "7. SSH ke container lab")

**Interfaces:**
- Consumes: tipe dan route Task 4.

Ketentuan:
- **`SshAccounts`**: judul "Akun SSH". Data diambil dari `GET /api/ssh`, polling tiap 10 detik. Satu kartu atau baris per lab, dengan keadaan:
  - Belum ada akun: tombol **Ajukan**.
  - PENDING: "Menunggu persetujuan admin".
  - REJECTED atau REVOKED: "Ditolak" atau "Dicabut" beserta alasannya, dengan tombol **Ajukan lagi**.
  - APPROVED: username, tombol **Buat password** (atau **Buat ulang password** bila `passwordSet`), perintah `ssh <username>@<host>` dalam `<code>`, dan catatan "Butuh lease VPN aktif ke lab ini."
  - Error ditampilkan dengan `Alert`.
- **Dialog password** (native `<dialog>` seperti `ConfirmDialog`): menampilkan password dan perintah ssh, tombol **Salin** (`navigator.clipboard.writeText`), dan peringatan "Password ini hanya ditampilkan sekali. Simpan sekarang." Password hanya ada di state komponen dan dibuang saat dialog ditutup.
- **`AdminSsh`**:
  - Tab PENDING ("Menunggu"), APPROVED ("Disetujui"), REJECTED ("Ditolak"), REVOKED ("Dicabut"), dan "Riwayat" (dari `GET /api/admin/ssh/audit`). Pola tabel dan polling 10 detik mengikuti `AdminLeases.tsx`.
  - **Setujui** langsung satu klik.
  - **Tolak** dan **Cabut** lewat `ConfirmDialog` dengan `reasonLabel`.
- **Panduan**: langkah singkat ajukan, tunggu disetujui, buat password, aktifkan WireGuard, lalu SSH. Sertakan contoh perintah untuk PowerShell (Windows), Terminal (Mac/Linux), dan aplikasi SSH di HP.

- [ ] **Step 1: Implementasikan.**
- [ ] **Step 2: Typecheck dan build.** Perintah: `npm run typecheck && npm run build -w frontend && npm test -w frontend`. Hasil yang diharapkan: tanpa error.
- [ ] **Step 3: Cek di browser lokal.**
  - Jalankan API di VPS dengan `TEST_MODE=1 DB_PATH=<scratchpad>/ui.db PORT=8790 ADMIN_EMAILS=adm@singgah.invalid EXTRA_ALLOWED_EMAILS=adm@singgah.invalid,stu@singgah.invalid node backend/src/api/main.ts` (background).
  - Pakai `playwright-cli` dari folder kerja yang punya `.playwright/cli.config.json`. Login uji dilakukan lewat `fetch('/auth/test-login', ...)` dari halaman `http://127.0.0.1:8790`.
  - Jalani alurnya: mahasiswa mengajukan, admin menyetujui di `/admin/ssh`, mahasiswa membuat password, dialog muncul, lalu admin mencabut dan alasannya tampil ke mahasiswa.
  - Ambil screenshot lebar 390 px dan 1280 px. Hasil yang diharapkan: setiap keadaan tampil benar dan tidak ada error di console.
- [ ] **Step 4: Commit** `feat(frontend): bagian Akun SSH, dialog password sekali tampil, dan halaman admin SSH`.

### Task 10: Deploy dan uji di laptop gateway

- [ ] **Step 1: Review seluruh branch** (satu reviewer segar), lalu perbaiki temuannya.
- [ ] **Step 2: Minta izin pemilik** untuk push `feat/akun-ssh` dan merge ke `main`. Deploy menarik `main` lewat deploy key read-only.
- [ ] **Step 3: Deploy.** Perintah: `ssh laptop-s5 'sudo bash /opt/singgah/infra/laptop/deploy.sh'` (dua kali, karena `deploy.sh` ikut berubah). Hasil yang diharapkan: `singgah-api`, `singgah-worker`, dan `s5-labs` active, serta `docker ps` menampilkan `s5-lab-cloud`, `s5-lab-cyber`, dan `s5-lab-jarkom`.
- [ ] **Step 4: Selftest.** Perintah: `ssh laptop-s5 'sudo s5-selftest'`. Hasil yang diharapkan: semua cek lama dan cek SSH baru `PASS`, lalu `SEMUA LULUS`.
- [ ] **Step 5: Uji manual oleh pemilik**: ajukan, setujui, buat password, SSH dari laptop lewat tunnel, lalu cabut. Saat pemilik menguji, pantau log worker dan `docker logs s5-lab-cyber`.
- [ ] **Step 6: Perbarui ingatan.** Berkas `dari-claude/uji-singgah-2026-11-17.md` (atau berkas baru untuk uji SSH) dan memori proyek berisi status serta cara redeploy.
