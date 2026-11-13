import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Mark } from '../Layout.tsx';

// Public pages (no session needed): guide, plus the privacy/terms links on the Google consent screen.
function Doc({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link to="/login" className="inline-flex items-center gap-2 font-bold"><Mark className="size-8" /> Singgah</Link>
      <h1 className="mt-8 text-3xl font-extrabold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted">Berlaku sejak 13 November 2026</p>
      <div className="mt-6 space-y-4 text-[15px] leading-relaxed [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-bold [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
        {children}
      </div>
      <p className="mt-10 text-sm text-muted">
        <Link to="/panduan" className="underline">Panduan</Link> · <Link to="/privasi" className="underline">Kebijakan privasi</Link> · <Link to="/ketentuan" className="underline">Ketentuan layanan</Link> · <Link to="/" className="underline">Buka portal</Link>
      </p>
    </main>
  );
}

const LABS = [
  ['Lab Cloud Computing', '192.168.10.0/24', '192.168.10.10'],
  ['Lab Cyber Security', '192.168.20.0/24', '192.168.20.10'],
  ['Lab Jaringan Komputer', '192.168.30.0/24', '192.168.30.10'],
] as const;

export function Guide() {
  return (
    <Doc title="Cara Pakai Singgah">
      <p>Singgah memberimu akses VPN sementara ke <b>satu</b> lab TRI. Aksesnya berakhir otomatis setelah waktunya habis. Kamu cukup punya akun Google UGM dan aplikasi WireGuard.</p>

      <h2>1. Pasang aplikasi WireGuard</h2>
      <ul>
        <li><b>Android / iPhone / iPad:</b> cari "WireGuard" di Play Store atau App Store.</li>
        <li><b>Windows / macOS:</b> unduh dari <a href="https://www.wireguard.com/install/" className="underline" target="_blank" rel="noreferrer">wireguard.com/install</a>.</li>
        <li><b>Linux:</b> <code>sudo apt install wireguard-tools</code></li>
      </ul>

      <h2>2. Masuk</h2>
      <p>Buka <b>singgah.akzara.id</b> lalu pilih <b>Masuk dengan Google</b>. Gunakan akun <code>@mail.ugm.ac.id</code> atau <code>@ugm.ac.id</code>.</p>

      <h2>3. Ajukan akses</h2>
      <p>Pilih lab yang kamu butuhkan dan durasinya (1, 2, atau 4 jam, tidak melebihi batas lab), lalu tekan <b>Ajukan akses</b>. Kuota per orang 8 jam per hari, dan pulih pukul 00.00 WIB. Kamu hanya bisa punya satu akses aktif dalam satu waktu.</p>

      <h2>4. Pasang konfigurasi</h2>
      <ul>
        <li><b>HP:</b> di aplikasi WireGuard tekan <b>+</b> → <b>Scan from QR code</b>, lalu arahkan kamera ke QR di layar.</li>
        <li><b>Laptop:</b> tekan <b>Unduh .conf</b>, lalu di aplikasi WireGuard pilih <b>Import tunnel(s) from file</b>.</li>
        <li><b>Linux:</b> <code>sudo wg-quick up ./singgah-lab-xxx.conf</code></li>
      </ul>
      <p><b>Konfigurasi hanya ditampilkan sekali.</b> Kalau hilang sebelum dipasang, lepas lease lalu ajukan lagi. Jangan bagikan konfigurasimu ke orang lain.</p>

      <h2>5. Aktifkan dan pakai</h2>
      <p>Nyalakan tunnel di aplikasi WireGuard. Tunggu sampai dashboard Singgah menunjukkan <b>Siap dipakai</b> (biasanya beberapa detik). Setelah itu kamu bisa menjangkau perangkat di subnet lab, misalnya <code>ping 192.168.20.10</code> untuk Lab Cyber Security, atau layanan yang diberikan asisten lab.</p>
      <p>Hanya lalu lintas ke lab itu yang lewat VPN, jadi internetmu tetap seperti biasa. Lab lain dan perangkat pengguna lain memang tidak bisa dijangkau.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-line text-muted"><th className="py-2 pr-4 font-semibold">Lab</th><th className="py-2 pr-4 font-semibold">Subnet</th><th className="py-2 font-semibold">VM target</th></tr></thead>
          <tbody>
            {LABS.map(([name, net, ip]) => (
              <tr key={net} className="border-b border-line"><td className="py-2 pr-4">{name}</td><td className="py-2 pr-4"><code>{net}</code></td><td className="py-2"><code>{ip}</code></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted">Subnet lab tujuanmu juga tertulis di baris <code>AllowedIPs</code> pada file konfigurasi.</p>

      <h2>6. Selesai</h2>
      <p>Tekan <b>Lepas Lease</b> di dashboard bila sudah selesai, supaya sisa waktumu kembali ke kuota. Lalu matikan tunnel di aplikasi WireGuard. Kalau waktunya habis, akses dicabut otomatis, dan konfigurasi lama tidak bisa dipakai lagi.</p>

      <h2>Kalau ada masalah</h2>
      <ul>
        <li><b>Lama di "Menunggu gateway…":</b> tunggu beberapa detik. Kalau tetap begitu, muat ulang halaman.</li>
        <li><b>Tunnel menyala tapi lab tidak bisa dijangkau:</b> lihat "Latest handshake" di aplikasi WireGuard. Kalau tidak pernah muncul, jaringanmu mungkin memblokir UDP port 51820. Coba data seluler atau jaringan lain.</li>
        <li><b>"Kuota harian habis":</b> tunggu sampai pukul 00.00 WIB.</li>
        <li><b>"Lease sebelumnya masih ditutup":</b> tunggu beberapa detik setelah melepas lease, lalu ajukan lagi.</li>
        <li><b>Akses berakhir sebelum waktunya:</b> admin dapat mencabut akses. Hubungi admin lab TRI.</li>
      </ul>
    </Doc>
  );
}

export function Privacy() {
  return (
    <Doc title="Kebijakan Privasi">
      <p>Singgah adalah portal akses VPN sementara ke jaringan lab Teknologi Rekayasa Internet (TRI), Sekolah Vokasi UGM. Singgah dibuat sebagai proyek mata kuliah Komputasi Awan dan saat ini berstatus <i>proof of concept</i>.</p>
      <h2>Data yang kami simpan</h2>
      <ul>
        <li>Nama dan alamat email dari akun Google kamu. Kami hanya meminta izin dasar: <code>openid</code>, <code>email</code>, dan <code>profile</code>.</li>
        <li>Riwayat akses (<i>lease</i>): lab, IP tunnel, waktu mulai dan berakhir, status, serta alasan bila dicabut.</li>
        <li>Kunci publik WireGuard perangkatmu dan jumlah data yang terkirim dan diterima lewat tunnel.</li>
        <li>Alamat IP yang kamu pakai saat mengajukan akses.</li>
        <li>Log audit setiap penerbitan, pencabutan, dan kedaluwarsa akses.</li>
      </ul>
      <h2>Yang tidak kami simpan</h2>
      <ul>
        <li>Kunci privat WireGuard. Kunci ini dibuat sesaat, hanya diberikan sekali kepadamu, lalu dibuang dari server.</li>
        <li>Kata sandi Google kamu.</li>
        <li>Isi lalu lintas jaringanmu.</li>
      </ul>
      <h2>Untuk apa data dipakai</h2>
      <p>Data dipakai untuk menerbitkan dan mencabut akses, menghitung kuota harian, menjaga keamanan jaringan lab, dan menelusuri insiden sampai ke pemilik akun. Data tidak dijual dan tidak dipakai untuk iklan.</p>
      <h2>Cookie dan pihak ketiga</h2>
      <p>Singgah memakai satu cookie sesi (berlaku 12 jam) dan satu cookie sementara selama proses login. Tidak ada cookie analitik. Login diproses oleh Google. Halaman portal melewati Cloudflare, dan tampilan memuat font dari Google Fonts. Lalu lintas VPN melewati server relay yang hanya meneruskan paket terenkripsi.</p>
      <h2>Penyimpanan dan penghapusan</h2>
      <p>Data disimpan di server gateway milik tim proyek selama masa uji coba, dan dihapus setelah proyek selesai. Log audit tidak bisa diubah lewat aplikasi. Untuk meminta salinan atau penghapusan data, hubungi admin lab TRI.</p>
    </Doc>
  );
}

export function Terms() {
  return (
    <Doc title="Ketentuan Layanan">
      <p>Dengan masuk ke Singgah, kamu menyetujui ketentuan berikut.</p>
      <ul>
        <li>Singgah hanya untuk kegiatan akademik (praktikum dan riset) di lab TRI yang kamu pilih saat mengajukan akses.</li>
        <li>Dilarang memindai, menyerang, atau mencoba masuk ke jaringan dan perangkat selain lab tujuanmu.</li>
        <li>Konfigurasi WireGuard bersifat pribadi. Jangan bagikan kepada orang lain.</li>
        <li>Akses berakhir otomatis sesuai durasi yang kamu pilih, dengan kuota maksimal 8 jam per hari. Admin dapat mencabut akses kapan saja dengan menyertakan alasan.</li>
        <li>Setiap penerbitan dan pencabutan akses dicatat, dan dapat ditelusuri bila terjadi insiden.</li>
        <li>Layanan ini berstatus uji coba, sehingga tidak ada jaminan ketersediaan. Pelanggaran dilaporkan ke pengelola lab.</li>
      </ul>
    </Doc>
  );
}
