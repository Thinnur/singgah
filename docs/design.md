# Singgah: Dokumen Desain Worker, Web API, dan Frontend

Tanggal: 12/11/2026
Dasar: `PRD-VPN-Gateway.md` v1.1 (semua nomor "PRD x.y" merujuk ke dokumen itu)
Status: draf, menunggu persetujuan

Penanda: **[diputuskan]** berarti dipilih oleh pemilik proyek. **[keputusan desainer]** berarti dipilih penulis dokumen dan boleh dikoreksi. **[builder]** berarti diserahkan ke pembangun.

---

## 1. Maksud

Singgah (*Self-Service Ephemeral Lab Access*) adalah portal swalayan. Sivitas UGM login dengan Google, memilih lab dan durasi, lalu menerima konfigurasi WireGuard yang hanya menjangkau lab itu. Akses dicabut otomatis saat waktunya habis. Latar belakang lengkap ada di PRD bagian Pendahuluan.

Infrastruktur jaringan (relay, WireGuard, subnet lab simulasi, segmentasi dasar) **sudah berjalan** (bagian 3). Dokumen ini mencakup tiga bagian yang belum ada: **worker rekonsiliasi**, **web API**, dan **frontend**, beserta cara mengemas dan memasangnya.

Demo akhir: **26/11/2026**, berupa alur penuh: terbit, ditolak, kedaluwarsa, dan dicabut admin.

## 2. Sasaran, Bukan Sasaran, Anti-Sasaran

**Sasaran** (semua dari PRD):
- Pengajuan sampai konfigurasi diterima dalam waktu kurang dari 5 detik. Peer aktif paling lambat 5 detik kemudian (PRD 3.2).
- 100% lease kedaluwarsa dicabut paling lambat 30 detik setelah habis (PRD 4.3).
- Peer hanya menjangkau lab yang diminta, tidak menjangkau peer lain (PRD 5).
- Setiap penerbitan, pencabutan, dan kedaluwarsa tercatat dan bisa ditelusuri sampai ke pemilik akun (PRD 7).
- Gateway pulih sendiri setelah reboot dari isi database (PRD 3.4).

**Bukan sasaran** (PRD "Di Luar Cakupan" + keputusan desainer):
- Perpanjangan lease, banyak lab per lease, persetujuan berjenjang, IPv6, HA, aplikasi klien sendiri.
- CI/CD otomatis. Deploy cukup lewat skrip **[keputusan desainer]**.
- Skrip benchmark PRD 8 (iperf3, 100 permintaan, 50 lease). Itu milestone 24/11 dan jadi tugas terpisah. PRD 8.2 mensyaratkan pengukuran dari perangkat di LAN rumah laptop, jadi perlu anggota tim yang ada di lokasi. Desain ini hanya wajib menyediakan **mode uji** yang memungkinkannya **[keputusan desainer]**.

**Anti-sasaran** (gagal walau "jalan"):
- *Private key* klien tersimpan di mana pun (disk, database, log). Ini melanggar PRD 2.5.
- Web API memegang hak root atau mengubah wg0/nftables langsung. Ini melanggar PRD 6.2.
- Ada peer di `wg show wg0` tanpa lease aktif lebih dari satu siklus. Ini melanggar PRD 3.4 dan story #4.
- Mengubah aturan Docker, k3s, atau Tailscale di laptop, atau memakai `nft flush ruleset`.

## 3. Yang Sudah Berjalan (fakta, per 12/11/2026)

| Komponen | Detail |
|---|---|
| VPS relay | `103.93.133.235`, Ubuntu 24.04. nft table `ip s5relay` (`/etc/s5-relay.nft`, `s5-relay.service`): udp/51820 dari eth0 di-DNAT ke `100.68.173.108:51820`, lalu di-masquerade ke tailscale0. Autoload modul kernel di VPS mati, jadi modul baru harus di-`modprobe` manual. |
| Tailscale | VPS `s5-relay-vps` = `100.68.122.86`. Laptop `serverluis-1` = `100.68.173.108` (node di-*share* dari tailnet lain). Koneksinya langsung, tanpa DERP. |
| Laptop gateway | Ubuntu 26.04, kernel 7.0. Akses: `ssh laptop-s5` dari VPS, sudo NOPASSWD sementara (`/etc/sudoers.d/90-s5-vps`). Ada Docker, k3s, Tailscale. |
| wg0 | `wg-quick@wg0`: `10.8.0.1/24`, port 51820, MTU 1200, tanpa peer di file. Public key gateway: `DEgt5zLQb88/fJzae0f/U+kdcPmgWkyzWwwYJ7UtM2Y=` |
| Lab simulasi | `s5-labs.service` → `/usr/local/sbin/s5-labs up\|down`. Netns `lab-cloud` 192.168.10.0/24, `lab-cyber` 192.168.20.0/24, `lab-jarkom` 192.168.30.0/24. Veth `s5-<id>`, host `.1`, target `.10`. |
| Segmentasi | nft table `ip s5gw`: set `lab_<id>`, chain forward (established accept, satu accept per lab berdasarkan set, drop sisa dari/ke wg0), chain input (wg0 hanya boleh ping 10.8.0.1). Dua ACCEPT di `DOCKER-USER` (`wg0`↔`s5-+`). |
| Uji | `sudo s5-selftest` di laptop: 10 cek segmentasi lewat relay, semua lulus. HP sungguhan juga sudah lulus. |
| Domain | `akzara.id` di Cloudflare. Subdomain yang ada disajikan lewat Cloudflare Tunnel (`cloudflared`, berbasis token) di VPS. |

Semua file infra di atas dibuat di sesi sebelumnya dan **belum ada di repo**. Salinannya masuk ke `infra/` (bagian 9).

## 4. Keputusan yang Sudah Diambil

- Nama produk **Singgah**, subdomain **`singgah.akzara.id`**, repo GitHub **`singgah`** **[diputuskan]**.
- Repo **private** di akun GitHub pemilik proyek, anggota tim diundang sebagai kolaborator **[diputuskan]**.
- Backend **Node.js + TypeScript**, untuk web API dan worker **[diputuskan]**.
- Frontend **terpisah dan modern**: **React + Vite + TypeScript** **[diputuskan; pilihan React/Vite oleh desainer, disetujui]**.
- Satu repo berisi `backend/`, `frontend/`, `infra/`, `docs/` **[diputuskan]**.
- Database **SQLite**, satu file di laptop **[disetujui]**.
- Hasil build frontend disajikan oleh API **dari origin yang sama**, sehingga tidak ada CORS dan cookie lintas domain **[disetujui]**.
- Portal publik lewat **Cloudflare Tunnel yang sudah ada di VPS**: `https://singgah.akzara.id` → tunnel → VPS → Tailscale → API di laptop **[disetujui]**.
- Login Google **OAuth (External, scope `openid email profile`)** di proyek Google Cloud milik tim. Tidak butuh akses admin Workspace UGM **[disetujui]**.
- **Satu pembangun** untuk tahap ini. Tim membaca dan mereview lewat GitHub, tapi belum ikut menulis kode **[diputuskan]**. Akibatnya, pengerjaan dilakukan per potongan fitur dari ujung ke ujung (database → API → worker → UI). Bentuk API tidak perlu dikunci di awal. Commit langsung ke `main` boleh, dan aturan branch/PR baru dibuat saat tim mulai ikut menulis kode **[keputusan desainer]**.

## 5. Arsitektur

```
Browser ──HTTPS──> Cloudflare ──tunnel──> cloudflared (VPS) ──Tailscale──> singgah-api (laptop, user biasa)
                                                                              │ tulis/baca
                                                                              ▼
                                                                    SQLite /var/lib/singgah/singgah.db
                                                                              ▲ baca/tulis
HP/Laptop klien ──UDP 51820──> VPS relay ──Tailscale──> wg0 <── singgah-worker (CAP_NET_ADMIN saja)
                                                         │        menjalankan `wg` dan `nft`
                                                         ▼
                                                 s5gw (nft) ──> lab-<id> (netns)
```

Satu-satunya jalur komunikasi antara API dan worker adalah **database**. API tidak memanggil worker, dan worker tidak membuka port.

### 5.1 singgah-api
- Proses Node.js, systemd `singgah-api.service`, user sistem `singgah`, **tanpa capability apa pun** (PRD 6.2).
- Menyajikan JSON API di `/api/*` dan `/auth/*`, plus file statis hasil build frontend untuk path lain (SPA fallback ke `index.html`).
- Listen di port TCP **8080**, atau port lain yang bebas kalau 8080 sudah dipakai Docker/k3s **[builder memeriksa]**.
- **Hanya boleh dijangkau dari VPS dan localhost.** Tambahkan aturan di chain `input` table `s5gw`: izinkan port itu dari `iifname "lo"` dan dari `ip saddr 100.68.122.86`, drop sisanya. Batas ini wajib, karena API mempercayai header IP klien dari Cloudflare (5.5).
- *Keypair* klien dibuat **di proses API, di memori**, dengan `crypto.generateKeyPairSync('x25519')` milik Node. Kunci diekspor sebagai 32 byte mentah dan di-*base64* (format WireGuard), tanpa memanggil program luar. Hanya public key yang disimpan. Teks konfigurasi (berisi private key) dikembalikan **sekali** dalam respons pengajuan, lalu dibuang. Jangan pernah dicatat ke log.

### 5.2 singgah-worker
- Proses Node.js terpisah, systemd `singgah-worker.service`, user `singgah`, `AmbientCapabilities=CAP_NET_ADMIN`, `CapabilityBoundingSet=CAP_NET_ADMIN`. Capability ini diwariskan ke `wg` dan `nft` yang dijalankannya.
- Siklus rekonsiliasi setiap `RECONCILE_INTERVAL_S` (default 5) detik (PRD 4.1). Algoritmanya di bagian 7.
- Hanya satu instance yang boleh berjalan. systemd sudah menjamin ini. Kalau dijalankan manual, pakai lock file **[builder]**.
- Memakai perintah `wg` dan `nft`, seperti yang tertulis di PRD 3.1 dan 4.2. Perubahan nft dikirim per siklus dalam **satu transaksi** `nft -f -`.

### 5.3 Pembagian kepemilikan nftables
- **`s5-labs` (infra)** memiliki netns lab simulasi dan **kerangka** table `s5gw`: chain forward dan input dengan aturan drop dasar, serta ACCEPT di `DOCKER-USER`. Skrip ini **tidak lagi** membuat set dan aturan accept per lab.
- **Worker** memiliki **set `lab_<id>` dan aturan accept per lab** untuk setiap lab di database, beserta isinya (IP tunnel lease aktif). Kalau set atau aturan suatu lab belum ada, worker membuatnya. Aturan accept harus berada **sebelum** drop dasar (pakai `insert` atau posisi eksplisit). Kalau `s5-labs` di-restart, set dan aturan lab hilang, lalu dipasang ulang pada siklus worker berikutnya.
- Alasannya: PRD story #3 meminta admin bisa menambah lab dari portal. Pada penerapan sungguhan, lab adalah subnet fisik, jadi cukup baris database ditambah set dan aturan nft, tanpa netns. **[keputusan desainer]**
- Konsekuensinya, lab baru yang ditambah admin pada PoC hanya bisa dijangkau kalau subnetnya ada. Tiga lab simulasi sudah ada. Lab tambahan untuk demo perlu ditambahkan juga ke daftar `LABS` di `s5-labs`.
- Bentuk aturan accept per lab yang dibuat worker: `iifname "wg0" ip saddr @lab_<id> ip daddr <target_cidr> accept`. Aturan ini memakai CIDR dari kolom lab, bukan nama veth `s5-<id>` seperti versi sekarang, supaya kode yang sama berlaku untuk lab fisik **[keputusan desainer]**.

### 5.4 Database
- File `/var/lib/singgah/singgah.db`, dimiliki `singgah:singgah`, mode 0640, dengan **WAL mode** dan `busy_timeout` supaya API dan worker bisa menulis bersamaan.
- Driver dan cara migrasi **[builder]**. Syaratnya: skema dibuat dan di-*upgrade* otomatis saat API dijalankan, dan worker menolak jalan kalau versi skema tidak cocok.

### 5.5 Login dan sesi
- OAuth 2.0 *authorization code flow* di server: `GET /auth/login` → Google → `GET /auth/callback`. Parameter `state` wajib diperiksa. Email diambil dari *ID token* yang sudah diverifikasi, dan `email_verified` harus `true`.
- **Aturan penerimaan (di server, PRD 1.1):** email berakhiran `@mail.ugm.ac.id` atau `@ugm.ac.id`, **atau** tercantum di `EXTRA_ALLOWED_EMAILS`. Daftar tambahan ini adalah cadangan kalau Workspace UGM memblokir aplikasi pihak ketiga, sekaligus untuk akun Gmail tim saat demo **[keputusan desainer]**.
- Peran: `admin` jika email ada di `ADMIN_EMAILS`, selain itu `student`. Peran dihitung ulang setiap kali login (PRD 1.2).
- Sesi: cookie `HttpOnly; Secure; SameSite=Lax`, berlaku 12 jam **[keputusan desainer]**. Penyimpanan sesinya **[builder]**.
- Perlindungan CSRF untuk semua permintaan yang mengubah data: SameSite=Lax ditambah body JSON wajib (`Content-Type: application/json`), atau token. Pilihan caranya **[builder]**, tapi perlindungannya wajib.
- IP asli pengguna portal diambil dari header `CF-Connecting-IP`. Header ini hanya dipercaya karena API hanya bisa dijangkau dari VPS (5.1), dan dicatat di audit saat lease terbit **[keputusan desainer]**. Ini menutup celah relay: gateway WireGuard hanya melihat `100.68.122.86` sebagai alamat semua klien.

### 5.6 Mode uji
`TEST_MODE=1` di konfigurasi membuka tiga hal (PRD 8.3), dan **semuanya mati secara default**:
- Durasi **1 menit** muncul di pilihan durasi, di samping 1, 2, dan 4 jam.
- Endpoint `POST /auth/test-login {email}` membuat sesi untuk email mana pun yang lolos aturan penerimaan, tanpa Google. Endpoint ini **hanya menerima permintaan dari loopback** (`127.0.0.1`/`::1`), sehingga tidak bisa dipakai lewat Cloudflare. Gunanya untuk skrip uji di laptop.
- Batas satu lease aktif dan kuota tetap berlaku. Skrip uji 50 lease memakai 50 email berbeda.
- Demo 26/11 boleh dijalankan dengan `TEST_MODE=1`, supaya langkah "kedaluwarsa" cukup memakai lease 1 menit. Test-login tetap tidak bisa diakses dari luar karena hanya menerima loopback **[keputusan desainer]**.

## 6. Model Data

Mengikuti PRD Appendix C, dengan tambahan yang ditandai ➕.

- **users**: id, email (unik), name, role (`student`/`admin`), created_at, ➕last_login_at.
- **labs**: id (teks, mis. `lab-cyber`), name, target_cidr, max_hours (default 4), is_active, ➕created_at.
  - Di-*seed* saat migrasi pertama: `lab-cloud` "Lab Cloud Computing" 192.168.10.0/24, `lab-cyber` "Lab Cyber Security" 192.168.20.0/24, `lab-jarkom` "Lab Jaringan Komputer" 192.168.30.0/24. Semua aktif dengan max_hours 4.
  - Nama set nft diturunkan dari id: `lab-cyber` → `lab_cyber`. Validasi id: `^lab-[a-z0-9]{1,20}$`.
- **leases**: id, user_id, lab_id, tunnel_ip, client_pubkey, status (`ACTIVE`/`EXPIRED`/`REVOKED`), starts_at, expires_at, revoked_by, reason, bytes_tx, bytes_rx, ➕revoked_at, ➕ended_at, ➕requester_ip.
  - `ended_at` diisi worker setelah peer dan elemen nft **benar-benar** dilepas (atau dipastikan tidak ada).
  - **Indeks unik parsial:**
    - `user_id WHERE status='ACTIVE'`: satu lease aktif per orang.
    - `tunnel_ip WHERE ended_at IS NULL`: IP baru kembali ke pool setelah worker selesai membersihkan. Ini mencegah IP lease yang baru dicabut langsung dipakai lease baru selagi peer lamanya masih terpasang **[keputusan desainer, sedikit lebih ketat dari PRD]**.
  - `bytes_rx`/`bytes_tx` dilihat dari sisi gateway: rx = diterima dari klien (unggahan klien), tx = dikirim ke klien. Label di UI harus jelas.
- **audit_log**: id, lease_id, action, actor, at, detail (JSON).
  - action: `ISSUED`, `REVOKED`, `EXPIRED` (PRD), ➕`CLOSED`. `CLOSED` ditulis worker saat lease REVOKED selesai dibersihkan, membawa byte akhir. Byte baru diketahui worker setelah API mencatat REVOKED.
  - detail minimal: email, tunnel_ip, lab_id, durasi yang diminta, requester_ip (untuk ISSUED), alasan (untuk REVOKED), bytes_rx/bytes_tx (untuk EXPIRED/CLOSED).
  - **Hanya bisa ditambah**: trigger SQLite `BEFORE UPDATE` dan `BEFORE DELETE` yang menolak (`RAISE(ABORT, ...)`) (PRD 7.2).

## 7. Algoritma Rekonsiliasi Worker

Setiap siklus:

1. **Baca keadaan nyata.** `wg show wg0 dump` memberi daftar peer (pubkey, allowed-ips, rx, tx). Daftar elemen per set dibaca dari `nft -j list table ip s5gw`.
2. **Baca keadaan yang diinginkan** dari database: lease `status='ACTIVE' AND expires_at > now()`.
3. **Simpan byte** untuk setiap peer yang masih terpasang dan punya lease (aktif, kedaluwarsa, atau dicabut), **sebelum** apa pun dilepas (PRD 4.2). Penghitung WireGuard kembali ke 0 setiap kali peer dipasang ulang (misalnya setelah reboot), jadi byte di database harus diakumulasi (nilai dasar ditambah penghitung saat ini), bukan ditimpa **[builder: mekanisme]**.
4. **Lepas** setiap peer yang tidak diinginkan, yaitu lease kedaluwarsa, lease dicabut, atau peer yatim tanpa lease: `wg set wg0 peer <PUB> remove`.
5. **Samakan nft** dalam satu transaksi: pastikan set dan aturan accept tiap lab ada (5.3), tambahkan IP yang kurang, dan hapus IP yang tidak diinginkan.
6. **Pasang** lease yang diinginkan tapi belum terpasang: `wg set wg0 peer <PUB> allowed-ips <ip>/32`.
7. **Tutup lease** yang sudah bersih:
   - ACTIVE tapi lewat `expires_at`: status `EXPIRED`, isi `ended_at`, audit `EXPIRED` dengan byte.
   - REVOKED dengan `ended_at` kosong: isi `ended_at`, audit `CLOSED` dengan byte.
8. Setiap kegagalan per peer **dicatat ke log** (journald) dan dicoba lagi di siklus berikutnya, tanpa menghentikan siklus (PRD 4.5).

Catatan:
- Langkah yang sama memulihkan gateway setelah reboot. wg0 dan `s5gw` kosong saat boot, lalu terisi ulang dari database pada siklus pertama (PRD 3.4).
- Peer manual di wg0 (misalnya peer uji HP `10.8.0.200`) **akan dihapus** worker sebagai peer yatim. Itu disengaja (story #4).
- Satu operasi `wg set` atau `nft` per peer harus selesai dalam waktu kurang dari 500 ms (PRD 3.3). Catat durasi siklus di log debug.
- Pool IP: `10.8.0.2`–`10.8.0.254`. API memilih IP bebas terkecil di dalam transaksi database bersama insert lease, dan indeks unik menjadi penjaga terakhir terhadap balapan.

## 8. Web API

Bentuk persis request/response **[builder]**. Perilaku yang wajib:

**Umum**
- `GET /api/me`: email, nama, peran, sisa kuota hari ini.
- `GET /api/labs`: daftar lab aktif (id, nama, max_hours) dan pilihan durasi yang diizinkan.

**Pemohon**
- `POST /api/leases {lab_id, hours}`. Divalidasi ulang di server (PRD 2.2). Urutan cek dan pesan penolakan (PRD 2.7, story #2):
  1. lab tidak ada atau nonaktif → "Lab sedang tidak tersedia".
  2. durasi bukan 1/2/4 (atau 1 menit di mode uji), atau melebihi `max_hours` lab → pesan batas.
  3. sudah punya lease ACTIVE → "Kamu masih punya lease aktif".
  4. kuota harian kurang → "Kuota harian habis, pulih pukul 00.00 WIB" beserta sisa jam.
  5. pool IP penuh → "Kapasitas sedang penuh, coba lagi nanti".

  Kalau lolos: buat keypair (5.1), simpan lease dengan IP dan public key, tulis audit `ISSUED`, lalu kembalikan data lease plus **teks konfigurasi** (sekali saja). Waktu respons harus di bawah 5 detik. Targetnya ratusan milidetik.
- `GET /api/leases/current`: lease aktif milik sendiri, sisa waktu, byte terakhir, dan status "peer sudah aktif" (dari `bytes`/flag worker, **[builder]**).
- `POST /api/leases/:id/release`: hanya untuk lease milik sendiri (PRD 1.5). Status menjadi `REVOKED`, `revoked_by`=email sendiri, reason "Dilepas pemohon", lalu audit `REVOKED`. Peer dilepas oleh worker (PRD flowchart 3).

**Admin** (peran admin wajib diperiksa di server)
- `GET /api/admin/leases?status=ACTIVE`: pemohon, IP tunnel, lab, sisa waktu, byte (story #3).
- `POST /api/admin/leases/:id/revoke {reason}`: alasan wajib diisi. Status menjadi REVOKED dan audit dicatat.
- `GET/POST/PATCH /api/admin/labs`: tambah lab (id, nama, target_cidr, max_hours) dan ubah nama/max_hours/is_active. CIDR divalidasi dan tidak boleh tumpang tindih dengan lab lain, pool tunnel 10.8.0.0/24, Tailscale 100.64.0.0/10, jaringan Docker (172.16.0.0/12), k3s (10.42.0.0/16, 10.43.0.0/16), maupun LAN rumah (192.168.1.0/24). Lab tidak dihapus, hanya dinonaktifkan. Menonaktifkan lab hanya menutup pengajuan baru, sedangkan lease yang sedang berjalan dibiarkan sampai habis atau dicabut admin (PRD story #3) **[keputusan desainer]**.
- `GET /api/admin/audit?ip=&email=&from=&to=`: penelusuran untuk story #4.
- `GET /api/admin/stats`: jumlah lease aktif, riwayat pemakaian per lab, dan throughput wg0 saat ini. Throughput dibaca dari `/sys/class/net/wg0/statistics/{rx,tx}_bytes`, yang tidak butuh capability (PRD 7.3, prioritas P5, boleh paling akhir).

**Kuota harian [keputusan desainer]**
- `DAILY_QUOTA_HOURS` default 8 (usulan PRD). Satu hari = hari kalender **WIB**, reset pukul 00.00 WIB.
- Yang dihitung adalah **waktu terpakai** lease yang dimulai hari ini: `min(now, revoked_at, expires_at) − starts_at`. Melepas lease lebih cepat mengembalikan sisa jamnya. Lease yang melewati tengah malam dihitung ke hari mulainya.
- Pengajuan diterima jika `terpakai + durasi_diminta ≤ kuota`.

**Teks konfigurasi klien**
```
[Interface]
PrivateKey = <dibuat di memori>
Address = <tunnel_ip>/32
MTU = 1200

[Peer]
PublicKey = <WG_SERVER_PUBKEY>
Endpoint = <WG_ENDPOINT>            # default 103.93.133.235:51820
AllowedIPs = 10.8.0.1/32, <target_cidr lab>
PersistentKeepalive = 25
```
`WG_ENDPOINT` bisa diubah lewat konfigurasi, misalnya ke IP LAN laptop untuk demo cadangan (PRD Pertanyaan Terbuka). MTU 1200 wajib (PRD 9.3). Nama file unduhan `singgah-<lab>.conf`.

## 9. Frontend

React + Vite + TypeScript, build ke `frontend/dist`, lalu disajikan API. Bahasa antarmuka **Indonesia** **[keputusan desainer]**. Tampilan modern dan rapi di HP maupun desktop. Pustaka UI dan gaya visualnya **[builder]**.

Halaman:
1. **Login**: tombol "Masuk dengan Google". Penolakan domain ditampilkan dengan jelas.
2. **Ajukan**: pilih lab aktif dan durasi. Durasi yang melebihi batas lab atau sisa kuota dinonaktifkan, dan sisa kuota ditampilkan. Validasi di form (PRD 2.2).
3. **Hasil**: tombol unduh `.conf`, QR code yang dibuat **di browser** dari teks konfigurasi, dan peringatan tegas bahwa konfigurasi hanya ditampilkan sekali (PRD 2.5). Langkah singkat: pasang aplikasi WireGuard, scan, aktifkan.
4. **Dashboard**: lease aktif dengan hitung mundur, lab, IP tunnel, byte, tombol "Lepas Lease" dengan konfirmasi, dan alasan penolakan terakhir kalau ada (PRD 2.6).
5. **Admin – Lease aktif**: tabel dengan tombol cabut yang meminta alasan.
6. **Admin – Lab**: tambah, ubah, aktif/nonaktif.
7. **Admin – Audit**: cari berdasarkan IP tunnel, email, dan rentang waktu.
8. **Admin – Statistik**: jumlah aktif, pemakaian per lab, throughput wg0 (paling akhir).

## 10. Repo, Konfigurasi, dan Pemasangan

**Struktur repo `singgah`**
```
backend/    # API + worker (satu paket TypeScript, dua entry point)
frontend/   # React + Vite
infra/
  vps/      # s5-relay.nft, s5-relay.service, catatan Tailscale/UFW/modul
  laptop/   # wg0.conf.example (tanpa kunci), s5-labs, s5-selftest, s5-labs.service,
            # singgah-api.service, singgah-worker.service, 90-s5-gateway.conf (sysctl),
            # deploy.sh
docs/       # PRD, dokumen desain ini, README pemasangan
```
- `infra/` berisi salinan file yang sekarang terpasang. `s5-labs` diubah sesuai 5.3 (tanpa set/aturan per lab), dan `s5-selftest` diperbarui sesuai perubahan itu.
- Rahasia **tidak pernah** di-commit. `.gitignore` mencakup `*.env`, `*.db`, `*.conf` hasil uji.
- README menjelaskan cara memasang ulang gateway dan VPS dari nol.

**Konfigurasi** `/etc/singgah/singgah.env` (root:singgah 0640):
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PUBLIC_URL=https://singgah.akzara.id`, `SESSION_SECRET`, `ADMIN_EMAILS`, `EXTRA_ALLOWED_EMAILS`, `DAILY_QUOTA_HOURS=8`, `RECONCILE_INTERVAL_S=5`, `WG_INTERFACE=wg0`, `WG_SERVER_PUBKEY`, `WG_ENDPOINT=103.93.133.235:51820`, `TUNNEL_POOL=10.8.0.0/24`, `DB_PATH=/var/lib/singgah/singgah.db`, `PORT=8080`, `TEST_MODE=0`.

**Pemasangan di laptop**
- Node.js LTS terpasang sistem-wide, sehingga systemd bisa memakainya. Cara pemasangannya **[builder]**.
- Kode di `/opt/singgah`. `deploy.sh`: `git pull`, install dependency, build frontend dan backend, migrasi, restart kedua service.
- Kedua unit systemd memakai hardening dasar (`NoNewPrivileges`, `ProtectSystem=strict` dengan `ReadWritePaths=/var/lib/singgah`, `PrivateTmp`). Worker tambah capability di 5.2. Detail unit **[builder]**.
- Urutan boot: worker `After=wg-quick@wg0.service s5-labs.service`. API cukup `After=network-online.target`.

**Langkah yang harus dilakukan pemilik proyek** (tidak bisa dikerjakan pembangun):
1. Membuat repo GitHub private `singgah` (atau mengizinkan pembangun membuatnya lewat `gh` setelah login) dan mengundang tim.
2. Menambahkan *Public Hostname* `singgah.akzara.id` → `http://100.68.173.108:<PORT>` di tunnel Cloudflare yang sudah ada (Zero Trust → Networks → Tunnels).
3. Membuat OAuth Client (Web application) di Google Cloud Console dengan redirect URI `https://singgah.akzara.id/auth/callback`, lalu memberikan Client ID dan Secret. Tes login akun `@mail.ugm.ac.id` dilakukan saat itu juga.
4. Menentukan isi `ADMIN_EMAILS` dan `EXTRA_ALLOWED_EMAILS`.

Sebelum langkah 2–3 selesai, semuanya tetap bisa dibangun dan dites lewat `http://localhost` dengan `TEST_MODE=1`.

## 11. Pengujian

- **Unit**: validasi pengajuan, perhitungan kuota (termasuk lewat tengah malam dan lepas lebih cepat), alokasi IP, aturan penerimaan email, pembuatan keypair (public key cocok dengan private key), dan teks konfigurasi. Framework tes **[builder]**.
- **Integrasi di laptop** (skrip, memakai pola peer di netns dari `s5-selftest`, lewat relay):
  1. test-login → ajukan lease ke `lab-cyber` → peer terpasang ≤ 5 detik → klien netns bisa ping `192.168.20.10` dan **tidak bisa** ping lab lain.
  2. Lepas lease → peer dan elemen nft hilang ≤ 5 detik → audit `REVOKED` + `CLOSED` dengan byte.
  3. Lease 1 menit → kedaluwarsa → dilepas ≤ 30 detik setelah habis → audit `EXPIRED` dengan byte.
  4. Restart `s5-labs` dan `wg-quick@wg0` (simulasi reboot) → worker memulihkan peer dan nft dari database.
  5. Peer yatim yang ditambahkan manual → dihapus dalam satu siklus.
- `s5-selftest` versi sekarang memasang peer uji langsung dengan `wg set`. Begitu worker berjalan, peer itu akan dihapus sebagai peer yatim dalam satu siklus. Karena itu `s5-selftest` dibuat ulang: peer ujinya dibuat sebagai **lease di database** (user khusus `selftest@local`, dijalankan sebagai root di laptop), lalu dipasang oleh worker. Dengan begitu tesnya sekaligus menguji jalur worker yang sebenarnya. Setelah selesai, lease dicabut dan audit-nya tetap tercatat dengan pelaku `selftest` **[keputusan desainer]**.
- **Reboot sungguhan** laptop belum pernah dites. Lakukan sekali setelah worker selesai dan sebelum demo, dengan izin pemilik laptop. Cek: wg0, lab, `s5gw`, API, dan worker naik sendiri, dan lease aktif pulih.
- Benchmark PRD 8 (100 permintaan, 50 lease, iperf3) di luar cakupan dokumen ini, tapi harus bisa dijalankan dengan mode uji.

## 12. Risiko dan Catatan

- **Sudo NOPASSWD** di laptop untuk akun `bocahnabine` harus dicabut setelah demo (`/etc/sudoers.d/90-s5-vps`).
- **Workspace UGM mungkin memblokir** login aplikasi pihak ketiga. Cadangannya `EXTRA_ALLOWED_EMAILS`. Kalau terjadi, catat di laporan.
- **Ketergantungan pada VPS**: portal dan WireGuard sama-sama lewat VPS dan Tailscale. Cadangan demo: `WG_ENDPOINT` diarahkan ke IP LAN laptop, dan portal dibuka lewat `http://<IP-LAN>:<PORT>`. Cadangan portal butuh aturan input tambahan dan **tidak** lewat HTTPS, jadi hanya untuk darurat **[builder: dokumentasikan saja]**.
- Laptop bukan milik pemilik proyek (milik anggota tim). Setiap perubahan di laptop (Node.js, user `singgah`, service baru) sebaiknya diberitahukan ke pemiliknya.

## 13. Urutan Pengerjaan yang Disarankan (mengikuti milestone PRD)

1. Repo dan kerangka (backend, frontend, infra yang ada) → **segera**.
2. Skema database, API pengajuan, konfigurasi, dan QR (dengan test-login) → **17/11**.
3. Worker rekonsiliasi dan pencabutan otomatis, termasuk perubahan kepemilikan nft (5.3) → **19/11**.
4. Login Google, halaman admin, dan audit → **21/11** (sebagian bergantung pada langkah pemilik proyek di 10).
5. Skrip uji integrasi, `s5-selftest` baru, dan tes reboot sungguhan → **24/11**. Benchmark PRD 8 dikerjakan terpisah (bagian 2).
