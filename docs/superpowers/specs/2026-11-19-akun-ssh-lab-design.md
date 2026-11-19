# Singgah: Akun SSH di Container Lab dengan Persetujuan Admin

Tanggal: 19/11/2026
Dasar: `docs/design.md` (desain Singgah), `docs/PRD-VPN-Gateway.md`
Status: draf, menunggu persetujuan

Penanda: **[diputuskan]** berarti dipilih pemilik proyek. **[keputusan desainer]** berarti dipilih penulis dokumen dan boleh dikoreksi. **[builder]** berarti diserahkan ke pembangun.

---

## 1. Maksud

Saat ini pemegang lease VPN hanya bisa membuka halaman web uji di target lab (`192.168.<x>.10`). Target itu bukan VM, melainkan network namespace di laptop gateway yang berbagi filesystem dan proses dengan laptop. Karena itu target tersebut tidak bisa diberi SSH dengan aman.

Fitur ini mengganti target `.10` di tiap lab dengan **container Linux ber-SSH**. Mahasiswa mendapat akun pribadi (username diambil dari emailnya) di container lab, tetapi hanya **setelah admin menyetujui pengajuannya**. Fitur ini dipakai di demo 26/11/2026: pemilik proyek login sebagai mahasiswa, mengajukan akun, menyetujuinya sebagai admin, lalu SSH ke lab lewat tunnel.

## 2. Sasaran, Bukan Sasaran, Anti-Sasaran

**Sasaran**
- Mahasiswa mengajukan akun SSH per lab dari dashboard. Admin menyetujui atau menolak, dan alasan penolakan terlihat oleh mahasiswa. Admin juga bisa mencabut akun yang sudah disetujui. **[diputuskan]**
- Lease VPN tetap langsung aktif seperti sekarang. Hanya akun SSH yang perlu persetujuan. **[diputuskan]**
- Username diambil dari bagian depan email orang yang login. **[diputuskan]**
- Login dengan password. Password dibuat portal saat mahasiswa menekan "Buat password", ditampilkan sekali, dan bisa dibuat ulang kapan saja. **[diputuskan]**
- Ada satu container per lab yang dipakai bersama. Setiap mahasiswa punya folder sendiri yang tetap tersimpan. Tidak ada sudo, dan prompt menunjukkan nama lab. Akun berlaku sampai dicabut admin, tidak terikat pada satu lease. **[diputuskan]**
- Akun bisa dipakai login paling lambat 10 detik setelah password dibuat. Setelah dicabut, login baru ditolak dan sesi yang sedang berjalan diputus paling lambat 10 detik. **[keputusan desainer]**
- SSH hanya bisa dilakukan pemegang lease aktif untuk lab itu. Ini sudah dijamin firewall `s5gw` yang ada, jadi tidak perlu aturan baru (bagian 3).

**Bukan sasaran**
- Login dengan kunci SSH, container per mahasiswa, akses sudo atau root di container.
- Akses internet atau LAN dari dalam container.
- Notifikasi email ke admin atau mahasiswa, kuota disk per mahasiswa, ganti password dari dalam container.
- Mahasiswa membatalkan pengajuan sendiri **[keputusan desainer]**.
- Lab yang dibuat lewat halaman admin otomatis mendapat container. Lab seperti itu sekarang pun belum mendapat netns, karena daftar lab jaringan hanya ada di `s5-labs`.

**Anti-sasaran** (dianggap gagal walau fiturnya "jalan")
- Password asli tersimpan atau tercatat di mana pun (database, berkas, log, atau respons API selain satu kali tampil). Yang boleh disimpan hanya hash crypt.
- Orang yang login ke container bisa menjangkau filesystem atau proses laptop, LAN rumah, internet, atau lab lain.
- Proses Singgah (API atau worker) mendapat akses ke Docker socket atau root. Akses ke Docker socket sama dengan root di laptop.
- Alur VPN lama atau 19 cek `s5-selftest` yang ada menjadi gagal.
- Aturan Docker, k3s, atau Tailscale diubah, atau `nft flush ruleset` dijalankan.

## 3. Kondisi Sekarang (fakta, dicek 19/11/2026)

- **Target lab.** `s5-labs up` membuat netns `lab-<id>` per lab, dengan veth `s5-<id>` di host (`.1`) dan `eth0` di netns (`.10`). Satu-satunya route di netns adalah `10.8.0.0/24 via .1`, tanpa default route. `s5-lab-web@<id>` (python, port 80) berjalan di netns itu lewat `NetworkNamespacePath=/run/netns/lab-<id>` dan dipakai self-test serta panduan.
- **Firewall `s5gw`** (rantai forward). Koneksi established diterima. Per lease ada aturan `iifname "wg0" ip saddr @lab_<id> ip daddr <subnet lab> accept` untuk semua port, dan sisa trafik wg0 di-drop. Artinya port 22 di `.10` sudah hanya terjangkau oleh pemegang lease lab itu.
- **Worker**: user `singgah`, hanya `CAP_NET_ADMIN`, `ProtectSystem=strict`, `ReadWritePaths=/var/lib/singgah`, siklus 4 detik. **API**: user `singgah`, tanpa capability, `NoNewPrivileges=yes`. `/var/lib/singgah` bermode `0750 singgah:singgah`.
- **Database**: `users`, `labs`, `leases`, `audit_log`, `sessions`. `audit_log` bersifat append-only lewat trigger, dan `action`-nya dibatasi CHECK ke `ISSUED/REVOKED/EXPIRED/CLOSED` yang terkait lease. Migrasi memakai `PRAGMA user_version` dan dijalankan API saat start.
- **Laptop**: Docker terpasang dan tidak ada container berjalan saat dicek. `openssl` ada, `sshpass` belum. Disk tersisa 65 GB.

## 4. Desain

### 4.1 Container lab **[keputusan desainer]**

- Image `singgah-lab-ssh` dibangun dari `infra/laptop/lab-ssh/Dockerfile`, berbasis Debian slim dengan `openssh-server` dan alat dasar (paket persisnya **[builder]**). Image dibangun oleh `deploy.sh` di laptop.
- `s5-labs` tetap memegang siklus hidup lab. Pada `up`, untuk tiap lab: jalankan `docker run -d --name s5-lab-<id> --network none --hostname lab-<id> ...`, lalu `ip netns attach lab-<id> <PID container>`. Dengan begitu `/run/netns/lab-<id>` menunjuk ke netns container, dan langkah veth, alamat, serta route yang sudah ada berjalan seperti biasa. Hasilnya: `.10` sekarang adalah container, `s5-lab-web@<id>` tetap berjalan tanpa perubahan di netns yang sama, dan nft maupun worker tidak berubah. Pada `down`: `ip netns del`, lalu `docker rm -f`.
  - Alasan: Docker tidak bisa bergabung ke netns bernama. Jaringan bridge Docker akan bertabrakan dengan aturan iptables Docker sendiri, padahal kebijakan sebenarnya ada di `s5gw`. Cara "attach" mempertahankan semua yang sudah teruji.
  - *shortcut*: container memakai `--restart=no`. Bila container atau daemon Docker mati, SSH lab itu mati sampai `systemctl restart s5-labs`. Ini cukup untuk demo dan harus dicatat di README.
- Batasan container: `--pids-limit`, `--memory`, dan `--cpus` dengan angka wajar **[builder]**, `--cap-drop ALL` ditambah hanya capability yang dibutuhkan sshd dan pembuatan akun **[builder]**, `--security-opt no-new-privileges`. Container tidak boleh `--privileged`, tidak boleh me-mount Docker socket, dan tidak boleh me-mount apa pun dari laptop selain direktori di bawah.
- Mount:
  - `/var/lib/singgah/labs/<lab-id>/`, read-only, berisi daftar akun yang ditulis worker (4.2). Yang di-mount direktorinya, bukan berkasnya, karena penulisan atomik lewat rename mengganti inode.
  - `/var/lib/singgah-labs/<lab-id>/home` ke `/home`, read-write.
  - `/var/lib/singgah-labs/<lab-id>/hostkeys` untuk host key sshd. Host key harus tetap sama saat container dibuat ulang (setiap restart `s5-labs` atau deploy). Kalau tidak, klien akan mendapat peringatan "REMOTE HOST IDENTIFICATION HAS CHANGED" di tengah demo.
- sshd: `PasswordAuthentication yes`, `PermitRootLogin no`, `AllowTcpForwarding no`, `AllowAgentForwarding no`, `X11Forwarding no`, `PermitTunnel no`, `MaxAuthTries 3`. SFTP tetap aktif. Prompt menampilkan nama lab, misalnya `budisantoso@lab-cyber:~$`.
- Container tidak punya default route, sehingga tidak bisa menjangkau internet atau LAN. Jangan ditambahkan.

### 4.2 Sinkronisasi akun **[keputusan desainer]**

- Sumber kebenarannya database. Dalam siklus yang sudah ada, worker menulis berkas `/var/lib/singgah/labs/<lab-id>/accounts` untuk setiap lab. Penulisannya atomik (tulis ke berkas sementara lalu rename) dan hanya dilakukan bila isinya berubah. Satu baris per akun berstatus APPROVED dengan format `username:uid:hash`. Hash kosong berarti akun sudah disetujui tetapi password belum dibuat, sehingga akun terkunci.
- Di dalam container, sebuah proses sinkron (skrip yang berjalan sebagai root container, dijalankan entrypoint bersama sshd) memeriksa berkas itu paling lambat tiap 3 detik. Setiap kali isinya berubah:
  - Setiap baris divalidasi: username `^[a-z][a-z0-9]{0,31}$`, uid 10000–59999, hash berformat crypt (`$6$` atau `$y$`) atau kosong. Baris yang tidak valid diabaikan dan dicatat di log container.
  - User yang belum ada dibuat dengan shell bash dan grup sendiri, tanpa grup sudo. Hash password-nya dipasang. `/home/<user>` dibuat dengan mode 0700 dan pemilik user itu bila belum ada.
  - User ber-uid ≥ 10000 yang tidak ada di berkas: semua prosesnya dihentikan, lalu akunnya dihapus. Folder home-nya tetap disimpan.
- uid = 10000 + `users.id`. Dengan begitu folder home tetap milik orang yang sama setelah container dibuat ulang.
- Alasan memakai cara ini: API dan worker tetap tidak memegang root maupun Docker socket. Bila user `singgah` dibobol, paling jauh ia bisa membuat akun biasa di container, karena validasi mencegah uid 0.
- Berkas akun berisi hash, jadi tidak boleh terbaca oleh user lain di laptop, tetapi harus terbaca oleh root di dalam container. Pengaturan mode, kepemilikan, dan capability untuk itu **[builder]**.

### 4.3 Data **[keputusan desainer; bentuk tabel boleh diubah builder]**

- Kolom baru `users.ssh_username TEXT UNIQUE`, diisi saat pengajuan pertama, tidak pernah berubah, dan sama di semua lab. Aturan pembentukannya:
  - Ambil bagian sebelum `@`, ubah ke huruf kecil, dan buang semua karakter selain a-z dan 0-9.
  - Tambahkan awalan `u` bila diawali angka. Potong agar ada ruang untuk sufiks, dengan batas total 32 karakter.
  - Bila bentrok dengan username lain atau dengan nama terlarang (root, admin, daemon, sshd, nobody, ubuntu, dan sejenisnya; daftar lengkap **[builder]**), tambahkan angka 2, 3, dan seterusnya.
- Tabel baru `ssh_accounts`: `id`, `user_id`, `lab_id`, `status` (`PENDING|APPROVED|REJECTED|REVOKED`), `requested_at`, `decided_at`, `decided_by`, `reason` (alasan tolak atau cabut), `password_hash`, `password_set_at`.
  - Paling banyak satu baris PENDING atau APPROVED per pasangan (user, lab), ditegakkan dengan indeks unik parsial.
  - Setelah REJECTED atau REVOKED, mahasiswa boleh mengajukan lagi sebagai baris baru.
  - Pengajuan ke lab nonaktif (`is_active=0`) ditolak. Akun yang sudah disetujui di lab yang kemudian dinonaktifkan tetap ada, tetapi tidak bisa dipakai karena lease ke lab itu tidak bisa diterbitkan.
- Jejak audit append-only untuk peristiwa diajukan, disetujui, ditolak, dicabut, dan password dibuat (tanpa hash), lengkap dengan pelaku dan waktu. Bentuknya **[builder]**: tabel baru dengan trigger append-only seperti `audit_log`, atau migrasi `audit_log`. Admin bisa melihat jejak ini.

### 4.4 API

Untuk mahasiswa yang sudah login (termasuk admin):
- `GET /api/ssh`: untuk setiap lab aktif, kembalikan status akun terakhir, username, alasan, apakah password sudah dibuat, dan alamat target (`.10`).
- `POST /api/ssh` `{labId}`: membuat pengajuan PENDING. Mengembalikan 409 bila sudah ada PENDING atau APPROVED.
- `POST /api/ssh/:id/password`: hanya untuk pemilik akun dengan status APPROVED.
  - Membuat password acak minimal 80 bit yang mudah diketik, tanpa karakter yang mirip satu sama lain. Formatnya **[builder]**.
  - Menyimpan hash sha512-crypt, misalnya lewat `openssl passwd -6 -stdin`. Password dikirim lewat stdin, bukan argumen, karena argumen terlihat di daftar proses **[builder]**.
  - Mengembalikan password sekali. Password lama otomatis tidak berlaku. Pembatasan laju sederhana **[builder]**.

Untuk admin:
- `GET /api/admin/ssh?status=`
- `POST /api/admin/ssh/:id/approve`
- `POST /api/admin/ssh/:id/reject` `{reason}` (alasan wajib)
- `POST /api/admin/ssh/:id/revoke` `{reason}` (alasan wajib)

Setiap perubahan status tercatat di jejak audit (4.3). Validasi dan format error mengikuti pola API yang sudah ada (`HttpError` dengan kode).

### 4.5 Frontend

- **Dashboard**: bagian baru "Akun SSH" yang mendaftar setiap lab beserta keadaannya:
  - Belum mengajukan: tombol **Ajukan**.
  - Menunggu persetujuan.
  - Ditolak atau dicabut: tampilkan alasannya, dengan tombol **Ajukan lagi**.
  - Disetujui: tampilkan username, tombol **Buat password** (atau **Buat ulang password**), contoh perintah `ssh <username>@192.168.20.10`, dan catatan bahwa SSH butuh lease VPN aktif ke lab itu.
- **Dialog password**: password ditampilkan sekali, ada tombol salin, dan ada peringatan bahwa password tidak bisa dilihat lagi.
- **Admin**: menu baru "Pengajuan SSH". Pengajuan PENDING tampil paling atas, dengan tombol **Setujui**, **Tolak** (wajib alasan), dan **Cabut** (wajib alasan), serta riwayatnya. Penanda jumlah pengajuan yang menunggu di menu admin **[builder, boleh dilewati]**.
- **Panduan**: langkah SSH dari Windows (`ssh` di PowerShell), Mac/Linux, dan HP (aplikasi seperti Termius).
- Gaya tampilan mengikuti komponen yang sudah ada (`ui.tsx`).

### 4.6 Uji

- **Unit test backend**: aturan username (normalisasi, bentrok, nama terlarang), transisi status, otorisasi (mahasiswa tidak bisa membuat password untuk akun orang lain dan tidak bisa memakai endpoint admin), password asli tidak pernah masuk database atau log, dan isi berkas akun yang ditulis worker.
- **`s5-selftest` (mode DB)** mendapat cek baru. Contohnya: akun selftest disetujui dengan hash password yang diketahui, lalu peer dengan lease lab-cyber berhasil login SSH ke `192.168.20.10` dengan password dan hostname-nya `lab-cyber`. Caranya bisa memasang `sshpass` di laptop lewat deploy, atau cara lain **[builder]**. Cek lainnya:
  - Peer dengan lease lab-cloud tidak bisa menjangkau `192.168.20.10:22`.
  - Dari dalam container: tidak bisa ping `192.168.1.1`, tidak bisa ke internet, dan `sudo` tidak tersedia.
  - Setelah akun dicabut, login ditolak dalam 10 detik.
  - Data uji dibersihkan di akhir. Semua 19 cek lama tetap lulus.
- **Uji manual (pemilik, sebelum demo)**: ajukan, setujui sebagai admin, buat password, SSH dari laptop lewat tunnel, lalu cabut.

### 4.7 Deploy

- `deploy.sh` membangun image, memasang `sshpass` bila dipakai, dan membuat direktori `/var/lib/singgah/labs/<id>` dan `/var/lib/singgah-labs/<id>/{home,hostkeys}`. Setelah itu skrip memasang `s5-labs` baru dan me-restart `s5-labs` beserta layanan Singgah. Migrasi database tetap dijalankan API saat start.
- Saat boot, `s5-labs` sudah berjalan setelah Docker (`After=docker.service`). Container dibuat ulang, worker menulis ulang berkas akun, dan akun kembali tersedia. Uji reboot laptop tetap belum dilakukan dan butuh izin pemilik.

## 5. Diserahkan ke Builder

Nama berkas dan fungsi, bentuk jejak audit, angka batas container, daftar capability, daftar username terlarang, format password, paket di image, cara menguji login di self-test, dan letak bagian SSH di dashboard.

## 6. Risiko dan Batas yang Diketahui

- Semua mahasiswa satu lab berbagi container, sehingga bisa melihat proses satu sama lain lewat `ps`. Folder home dibuat 0700.
- Tidak ada kuota disk, sehingga mahasiswa bisa mengisi disk laptop lewat `/home`. Ini diterima untuk demo. Pembatasannya (misalnya loop device berukuran tetap per lab) dikerjakan nanti.
- Bila container mati, SSH lab itu mati sampai `s5-labs` di-restart (4.1).
- Restart `s5-labs` (termasuk saat deploy) memutus semua sesi SSH. Berkas di luar `/home` ikut hilang karena container dibuat ulang.
