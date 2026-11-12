#!/bin/bash
# Singgah: perbarui kode di laptop gateway lalu restart service. Jalankan sebagai root:
#   sudo bash /opt/singgah/infra/laptop/deploy.sh
set -euo pipefail
export PATH=/opt/node-v24.22.1/bin:$PATH   # npm ber-shebang "env node": jangan sampai jalan di node sistem v20
cd /opt/singgah
git pull --ff-only
# unit dari checkout yang baru di-pull, sebelum restart apa pun
install -m 644 infra/laptop/s5-labs.service infra/laptop/singgah-api.service infra/laptop/singgah-worker.service /etc/systemd/system/
systemctl daemon-reload
npm ci
if [ -d frontend ]; then npm run build -w frontend; fi
install -m 755 infra/laptop/s5-labs infra/laptop/s5-selftest /usr/local/sbin/
# lid/suspend diabaikan; berlaku setelah reboot (systemd-logind sengaja tidak di-restart)
install -D -m 644 infra/laptop/90-singgah-nosuspend.conf /etc/systemd/logind.conf.d/90-singgah-nosuspend.conf
# s5-labs menghapus set/aturan lab; worker memasangnya lagi pada siklus berikutnya
for u in s5-labs singgah-worker singgah-api; do systemctl restart $u; done
