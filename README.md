# Singgah

Portal VPN WireGuard swadaya untuk lab: pengguna masuk dengan email UGM, mengajukan akses ke sebuah lab selama 1, 2, atau 4 jam, lalu mendapat konfigurasi WireGuard. Worker mencabut akses otomatis saat lease berakhir.

Backend Node.js 24 + TypeScript (Fastify, `node:sqlite`); frontend React menyusul.

## Struktur repo

- `backend/` : API dan worker (TypeScript dijalankan langsung oleh Node).
- `docs/` : PRD, desain (`design.md`), rencana (`plan.md`), diagram alur.
- `infra/vps/` : konfigurasi relay di VPS (nftables, systemd, Tailscale).
- `infra/laptop/` : salinan skrip dan konfigurasi gateway di laptop (`wg0.conf.example` tanpa private key).

## Perintah

```
npm test
npm run typecheck
```

## Pemasangan di laptop gateway

Laptop gateway sudah menjalankan `wg-quick@wg0` (lihat `infra/laptop/wg0.conf.example`, sysctl `90-s5-gateway.conf`) dan relay VPS (`infra/vps/`). Singgah dipasang di atasnya tanpa menyentuh Node sistem, Docker, k3s, atau Tailscale:

- Node `v24.22.1` dari tarball resmi (diverifikasi `SHASUMS256.txt`) di `/opt/node-v24.22.1`.
- User sistem `singgah`, kode `/opt/singgah` (milik root, di-clone lewat deploy key read-only), database `/var/lib/singgah/singgah.db`, konfigurasi `/etc/singgah/singgah.env` (root:singgah 0640, contoh lengkap di `infra/laptop/singgah.env.example`).
- Service `singgah-api` (tanpa capability, port 8780) dan `singgah-worker` (`CAP_NET_ADMIN`, menjalankan `wg` dan `nft`).
- `s5-labs` hanya memasang netns lab dan kerangka table `ip s5gw`. Set `lab_<id>` dan aturan accept per lab (`comment "singgah:<lab-id>"`) dibuat worker. Port 8780 hanya terbuka untuk `lo` dan relay VPS `100.68.122.86`.

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

`deploy.sh`: `git pull --ff-only`, pasang file unit systemd dari checkout terbaru lalu `daemon-reload`, `npm ci`, build frontend (bila ada), pasang `s5-labs` dan `s5-selftest` ke `/usr/local/sbin/`, lalu restart `s5-labs`, `singgah-worker`, `singgah-api`.

**Cek cepat:** `systemctl is-active singgah-api singgah-worker s5-labs`, `journalctl -u singgah-worker -f`, `sudo nft list table ip s5gw`, `curl -s localhost:8780/api/me` (401 bila belum login).

**CLI lease (uji mandiri) wajib dijalankan sebagai user `singgah`, jangan sebagai root.** Kalau root yang membuka database, file `singgah.db-wal`/`-shm` bisa jadi milik root dan service tidak bisa menulis lagi.

```
sudo bash -c 'set -a; . /etc/singgah/singgah.env; set +a; exec runuser -u singgah -- \
  /opt/node-v24.22.1/bin/node /opt/singgah/backend/src/cli/lease.ts revoke --id 3 --reason uji'
```

**Rollback:** `sudo systemctl disable --now singgah-api singgah-worker`, kembalikan `s5-labs` lama (`sudo cp /usr/local/sbin/s5-labs.bak-pre-singgah /usr/local/sbin/s5-labs && sudo systemctl restart s5-labs`). Node `/opt/node-v24.22.1`, `/opt/singgah`, `/var/lib/singgah`, `/etc/singgah`, dan user `singgah` bisa dihapus tanpa memengaruhi service lain.
