import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Mark } from '../Layout.tsx';

// Public pages (no session needed) linked from the Google OAuth consent screen.
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
        <Link to="/privasi" className="underline">Kebijakan privasi</Link> · <Link to="/ketentuan" className="underline">Ketentuan layanan</Link> · <Link to="/login" className="underline">Masuk</Link>
      </p>
    </main>
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
