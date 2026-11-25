#!/bin/bash
# Singgah: perbarui kode di laptop gateway lalu restart service. Jalankan sebagai root:
#   sudo bash /opt/singgah/infra/laptop/deploy.sh
set -euo pipefail
export PATH=/opt/node-v24.22.1/bin:$PATH   # npm ber-shebang "env node": jangan sampai jalan di node sistem v20
cd /opt/singgah
git pull --ff-only
# unit dari checkout yang baru di-pull, sebelum restart apa pun
install -m 644 infra/laptop/s5-labs.service infra/laptop/singgah-api.service infra/laptop/singgah-worker.service \
  'infra/laptop/s5-lab-web@.service' /etc/systemd/system/
systemctl daemon-reload
# halaman uji per lab (ikut start/restart bersama s5-labs); daftar lab dari LABS di s5-labs
for l in $(sed -n 's/^LABS="\([^"]*\)".*/\1/p' infra/laptop/s5-labs); do systemctl enable --quiet "s5-lab-web@${l%%:*}"; done
npm ci
if [ -d frontend ]; then npm run build -w frontend; fi
install -m 755 infra/laptop/s5-labs infra/laptop/s5-selftest /usr/local/sbin/
# lid/suspend diabaikan; berlaku setelah reboot (systemd-logind sengaja tidak di-restart)
install -D -m 644 infra/laptop/90-singgah-nosuspend.conf /etc/systemd/logind.conf.d/90-singgah-nosuspend.conf
# container lab (target .10 tiap lab, akun SSH) dan sshpass untuk cek SSH s5-selftest
command -v sshpass >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y -q sshpass
docker build -q -t singgah-lab-ssh infra/laptop/lab-ssh >/dev/null
# DNS klien VPN (Bind9, hanya di 10.8.0.1) dan reverse proxy portal (nginx)
dpkg -s bind9 bind9-dnsutils nginx >/dev/null 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y -q bind9 bind9-dnsutils nginx
install -m 644 infra/laptop/bind/named.conf.options infra/laptop/bind/named.conf.local infra/laptop/bind/db.lab /etc/bind/
named-checkconf -z >/dev/null
systemctl enable --quiet named
install -m 644 infra/laptop/nginx-singgah.conf /etc/nginx/sites-available/singgah
ln -sf /etc/nginx/sites-available/singgah /etc/nginx/sites-enabled/singgah
nginx -t -q
systemctl reload nginx
# s5-labs menghapus set/aturan lab; worker memasangnya lagi pada siklus berikutnya
for u in s5-labs singgah-worker singgah-api named; do systemctl restart $u; done
