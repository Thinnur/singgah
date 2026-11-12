#!/bin/bash
# Singgah: perbarui kode di laptop gateway lalu restart service. Jalankan sebagai root:
#   sudo bash /opt/singgah/infra/laptop/deploy.sh
# Perubahan file unit systemd butuh install.sh (aman diulang), bukan skrip ini.
set -euo pipefail
export PATH=/opt/node-v24.22.1/bin:$PATH   # npm ber-shebang "env node": jangan sampai jalan di node sistem v20
cd /opt/singgah
git pull --ff-only
npm ci
if [ -d frontend ]; then npm run build -w frontend; fi
install -m 755 infra/laptop/s5-labs infra/laptop/s5-selftest /usr/local/sbin/
# s5-labs menghapus set/aturan lab; worker memasangnya lagi pada siklus berikutnya
for u in s5-labs singgah-worker singgah-api; do systemctl restart $u; done
