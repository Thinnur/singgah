#!/bin/bash
# Host key disimpan di volume: sama setelah container dibuat ulang (klien tidak dapat peringatan "host key berubah").
set -eu
K=/etc/ssh/hostkeys/ssh_host_ed25519_key
[ -s "$K" ] || ssh-keygen -q -t ed25519 -N '' -C "$(hostname)" -f "$K"
/usr/local/sbin/sync-accounts.sh --loop &
exec /usr/sbin/sshd -D -e
