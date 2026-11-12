# Singgah

Portal VPN WireGuard swadaya untuk lab: pengguna masuk dengan email UGM, mengajukan akses ke sebuah lab selama 1, 2, atau 4 jam, lalu mendapat konfigurasi WireGuard. Worker mencabut akses otomatis saat lease berakhir.

Backend Node.js 24 + TypeScript (Fastify, `node:sqlite`); frontend React (Vite + Tailwind) dilayani backend dari `frontend/dist`.

## Struktur repo

- `backend/` : API dan worker (TypeScript dijalankan langsung oleh Node).
- `frontend/` : portal pemohon dan admin (React), di-build ke `frontend/dist`.
- `docs/` : PRD, desain (`design.md`), rencana (`plan.md`), diagram alur.
- `infra/vps/` : konfigurasi relay di VPS (nftables, systemd, Tailscale).
- `infra/laptop/` : salinan skrip dan konfigurasi gateway di laptop (`wg0.conf.example` tanpa private key).

## Perintah

```
npm test
npm run typecheck
npm run build -w frontend
```

## Pemasangan di laptop gateway

Laptop gateway sudah menjalankan `wg-quick@wg0` (lihat `infra/laptop/wg0.conf.example`, sysctl `90-s5-gateway.conf`) dan relay VPS (`infra/vps/`). Singgah dipasang di atasnya tanpa menyentuh Node sistem, Docker, k3s, atau Tailscale:

- Node `v24.22.1` dari tarball resmi (diverifikasi `SHASUMS256.txt`) di `/opt/node-v24.22.1`.
- User sistem `singgah`, kode `/opt/singgah` (milik root, di-clone lewat deploy key read-only), database `/var/lib/singgah/singgah.db`, konfigurasi `/etc/singgah/singgah.env` (root:singgah 0640, contoh lengkap di `infra/laptop/singgah.env.example`).
- Service `singgah-api` (tanpa capability, port 8780) dan `singgah-worker` (`CAP_NET_ADMIN`, menjalankan `wg` dan `nft`).
- `s5-labs` hanya memasang netns lab dan kerangka table `ip s5gw`. Table dipasang **paling awal** dalam satu transaksi atomik, jadi wg0 tetap terfilter walau langkah netns gagal. Set `lab_<id>` dan aturan accept per lab (`comment "singgah:<lab-id>"`) dibuat worker; selama sinkron nft gagal, worker tidak memasang peer baru. Port 8780 hanya terbuka untuk `lo` dan relay VPS `100.68.122.86`.
- Drop-in logind `90-singgah-nosuspend.conf` (`/etc/systemd/logind.conf.d/`): menutup lid/tombol suspend tidak menidurkan laptop (PRD 9.1). **Berlaku setelah reboot berikutnya**; `systemd-logind` sengaja tidak di-restart karena bisa mematikan sesi desktop pemilik laptop.

**Pasang pertama kali** (dari mesin mana pun yang punya repo):

```
scp infra/laptop/install.sh laptop-s5:/tmp/
ssh laptop-s5 'sudo bash /tmp/install.sh key' > singgah_deploy.pub   # buat deploy key, ambil public key-nya
gh repo deploy-key add singgah_deploy.pub -R Thinnur/singgah --title laptop-gateway   # read-only
ssh laptop-s5 'sudo TEST_MODE=1 PUBLIC_URL=http://localhost:8780 bash /tmp/install.sh'
```

`install.sh` aman diulang: deploy key, Node, user, clone, dan `singgah.env` yang sudah ada tidak ditimpa. Variabel yang diberikan lewat environment (contoh di atas) hanya dipakai saat `singgah.env` pertama kali dibuat. Untuk produksi, ubah `singgah.env`: `TEST_MODE=0`, `PUBLIC_URL=https://singgah.akzara.id`, isi `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` dan `ADMIN_EMAILS`, lalu `sudo systemctl restart singgah-api singgah-worker`. Saat pertama kali dipasang, `s5-labs` lama disimpan sebagai `/usr/local/sbin/s5-labs.bak-pre-singgah`.

**Perbarui (redeploy)** setelah push ke `main`:

```
ssh laptop-s5 'sudo bash /opt/singgah/infra/laptop/deploy.sh'
```

`deploy.sh`: `git pull --ff-only`, pasang file unit systemd dari checkout terbaru lalu `daemon-reload`, `npm ci`, build frontend (bila ada), pasang `s5-labs` dan `s5-selftest` ke `/usr/local/sbin/` serta drop-in logind, lalu restart `s5-labs`, `singgah-worker`, `singgah-api`.

**Uji mandiri:** `sudo s5-selftest` (lease lewat database, aman di produksi) dan `sudo s5-selftest --api` (lewat API, butuh `TEST_MODE=1`). Mode `--api` login sebagai `selftest-admin@singgah.invalid` (admin) dan `selftest-api@singgah.invalid` (pemohon). Domain `.invalid` tidak mungkin lolos verifikasi Google, jadi identitas ini hanya bisa dipakai lewat test-login. Keduanya wajib ada di `EXTRA_ALLOWED_EMAILS`, dan yang admin juga di `ADMIN_EMAILS`; kalau belum, skrip langsung berhenti dengan pesan.

**Cek cepat:** `systemctl is-active singgah-api singgah-worker s5-labs`, `journalctl -u singgah-worker -f`, `sudo nft list table ip s5gw`, `curl -s localhost:8780/api/me` (401 bila belum login).

**CLI lease (uji mandiri) wajib dijalankan sebagai user `singgah`, jangan sebagai root.** Kalau root yang membuka database, file `singgah.db-wal`/`-shm` bisa jadi milik root dan service tidak bisa menulis lagi.

```
sudo bash -c 'set -a; . /etc/singgah/singgah.env; set +a; exec runuser -u singgah -- \
  /opt/node-v24.22.1/bin/node /opt/singgah/backend/src/cli/lease.ts revoke --id 3 --reason uji'
```

**Rollback:** `sudo systemctl disable --now singgah-api singgah-worker`, kembalikan `s5-labs` lama (`sudo cp /usr/local/sbin/s5-labs.bak-pre-singgah /usr/local/sbin/s5-labs && sudo systemctl restart s5-labs`). Node `/opt/node-v24.22.1`, `/opt/singgah`, `/var/lib/singgah`, `/etc/singgah`, dan user `singgah` bisa dihapus tanpa memengaruhi service lain.

## Checklist go-live

1. `/etc/singgah/singgah.env`: isi `ADMIN_EMAILS` dengan admin sungguhan dan `EXTRA_ALLOWED_EMAILS` hanya dengan email yang memang perlu (hapus identitas `@singgah.invalid`). Peran dihitung ulang saat login, jadi setelah mengubah admin **kosongkan tabel sessions sebagai user `singgah`** (bukan root):
   ```
   cd / && sudo runuser -u singgah -- /opt/node-v24.22.1/bin/node -e \
     "new (require('node:sqlite').DatabaseSync)('/var/lib/singgah/singgah.db').exec('DELETE FROM sessions')"
   ```
2. `PUBLIC_URL=https://singgah.akzara.id` (tanpa garis miring di akhir).
3. Google Cloud Console: OAuth Client (Web application) dengan redirect URI `https://singgah.akzara.id/auth/callback`; isi `GOOGLE_CLIENT_ID` dan `GOOGLE_CLIENT_SECRET`.
4. Cloudflare Tunnel (cloudflared di VPS): Public Hostname `singgah.akzara.id` ke `http://100.68.173.108:8780`; aktifkan **Always Use HTTPS** dan **HSTS**.
5. Selama `TEST_MODE=1`, jangan pernah membuka port 8780 lewat proxy apa pun di laptop: test-login hanya dibatasi ke loopback.
6. Setelah demo selesai: `TEST_MODE=0`, lalu `sudo systemctl restart singgah-api singgah-worker`.
7. Tes reboot sungguhan (sekaligus mengaktifkan drop-in logind), lalu `sudo s5-selftest` (mode database). Jangan pakai `--api` di produksi.
8. Hapus `/etc/sudoers.d/90-s5-vps` setelah demo.

## Darurat

**Cadangan tanpa VPS** (desain §12): ubah `WG_ENDPOINT` ke IP LAN laptop (mis. `192.168.1.29:51820`) lalu restart `singgah-api`; config yang diunduh setelahnya langsung ke laptop. Portal bisa dibuka lewat `http://<IP-LAN>:8780`, tetapi chain input `s5gw` hanya membuka 8780 untuk `lo` dan relay VPS, jadi butuh aturan input tambahan untuk LAN. Jalur ini **tidak lewat HTTPS** (cookie dan config klien terkirim polos): hanya untuk keadaan darurat, cabut lagi aturannya setelah selesai.

**Membangun ulang wg0** dari `infra/laptop/wg0.conf.example`: salin ke `/etc/wireguard/wg0.conf` (root, 0600), isi `PrivateKey` dengan kunci lama dari cadangan, pasang sysctl `90-s5-gateway.conf` ke `/etc/sysctl.d/` (`sysctl --system`), lalu `systemctl enable --now wg-quick@wg0`. Peer tidak perlu ditulis: worker memasangnya lagi dari lease aktif dalam satu siklus. Bila kunci lama hilang, `wg genkey` membuat kunci baru: perbarui `WG_SERVER_PUBKEY` (`wg show wg0 public-key`) di `singgah.env`, restart `singgah-api`, dan semua config yang sudah diunduh tidak berlaku lagi (pemohon harus mengajukan ulang).
