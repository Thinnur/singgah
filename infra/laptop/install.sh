#!/bin/bash
# Singgah: pemasangan di laptop gateway. Jalankan sebagai root; aman diulang.
#   sudo bash install.sh key   -> hanya buat deploy key + entri ssh "github-singgah", cetak public key-nya
#                                 (tambahkan ke GitHub sebagai deploy key read-only sebelum langkah berikut)
#   sudo bash install.sh       -> pemasangan lengkap, diakhiri deploy.sh
# Variabel singgah.env yang diberikan lewat environment menimpa nilai contoh saat /etc/singgah/singgah.env
# pertama kali dibuat, mis.: sudo TEST_MODE=1 PUBLIC_URL=http://localhost:8780 bash install.sh
# Node sistem (v20) tidak disentuh: Node dipasang terpisah di /opt/node-v24.22.1.
set -euo pipefail
NODE_VER=v24.22.1
NODE_DIR=/opt/node-$NODE_VER
APP=/opt/singgah
ENVF=/etc/singgah/singgah.env

# deploy key read-only untuk clone/pull repo private
install -d -m 700 /root/.ssh
[ -f /root/.ssh/singgah_deploy ] || ssh-keygen -q -t ed25519 -N '' -C singgah-laptop-gateway -f /root/.ssh/singgah_deploy
if ! grep -q '^Host github-singgah$' /root/.ssh/config 2>/dev/null; then
	printf '%s\n' 'Host github-singgah' '  HostName github.com' '  User git' '  IdentityFile /root/.ssh/singgah_deploy' \
		'  IdentitiesOnly yes' '  StrictHostKeyChecking accept-new' >> /root/.ssh/config
	chmod 600 /root/.ssh/config
fi
if [ "${1:-}" = key ]; then cat /root/.ssh/singgah_deploy.pub; exit 0; fi

# Node dari tarball resmi, diverifikasi dengan SHASUMS256.txt (shortcut: hanya linux-x64)
if [ ! -x $NODE_DIR/bin/node ]; then
	t=$(mktemp -d)
	f=node-$NODE_VER-linux-x64.tar.xz
	curl -fsSLo "$t/$f" https://nodejs.org/dist/$NODE_VER/$f
	curl -fsSLo "$t/SHASUMS256.txt" https://nodejs.org/dist/$NODE_VER/SHASUMS256.txt
	(cd "$t" && grep "  $f\$" SHASUMS256.txt | sha256sum -c -)
	tar -xJf "$t/$f" -C "$t" --no-same-owner
	mv "$t/node-$NODE_VER-linux-x64" $NODE_DIR
	rm -rf "$t"
fi

id -u singgah >/dev/null 2>&1 ||
	useradd --system --user-group --home-dir /var/lib/singgah --no-create-home --shell /usr/sbin/nologin singgah
install -d -o singgah -g singgah -m 750 /var/lib/singgah

[ -d $APP/.git ] || git clone git@github-singgah:Thinnur/singgah.git $APP

install -d -m 755 /etc/singgah
if [ ! -f $ENVF ]; then
	while IFS= read -r l; do
		k=${l%%=*}
		if [[ $l =~ ^[A-Z_]+= ]] && [ -n "${!k+x}" ]; then echo "$k=${!k}"; else echo "$l"; fi
	done < $APP/infra/laptop/singgah.env.example > $ENVF
	chown root:singgah $ENVF
	chmod 640 $ENVF
fi

# cadangan s5-labs versi lama (sebelum set/aturan lab pindah ke worker), sekali saja
if [ -f /usr/local/sbin/s5-labs ] && [ ! -e /usr/local/sbin/s5-labs.bak-pre-singgah ]; then
	cp -p /usr/local/sbin/s5-labs /usr/local/sbin/s5-labs.bak-pre-singgah
fi

install -m 644 $APP/infra/laptop/s5-labs.service $APP/infra/laptop/singgah-api.service \
	$APP/infra/laptop/singgah-worker.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable s5-labs singgah-worker singgah-api

bash $APP/infra/laptop/deploy.sh
