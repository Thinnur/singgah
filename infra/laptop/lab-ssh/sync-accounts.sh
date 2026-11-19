#!/bin/bash
# Singgah: sinkron user Linux container lab dari berkas akun (ditulis singgah-worker, di-mount read-only).
# Per baris "username:uid:hash"; hash kosong = akun dikunci. Berjalan sebagai root container.
# Hash hanya lewat stdin chpasswd, tidak pernah argv: ps terlihat oleh semua user di container.
set -uo pipefail
ACCOUNTS=${ACCOUNTS:-/run/singgah/accounts}
NAME_RE='^[a-z][a-z0-9]{0,31}$'
HASH_RE='^\$6\$[./0-9A-Za-z]{1,16}\$[./0-9A-Za-z]{86}$'
UID_MIN=10000 UID_MAX=59999
log() { echo "sync-accounts: $*"; }

sync_once() {
	local -A want=()
	local n=0 line name uid hash rest cur_uid cur_name
	while IFS= read -r line || [ -n "$line" ]; do
		n=$((n + 1))
		[ -z "$line" ] && continue
		IFS=: read -r name uid hash rest <<<"$line"
		if ! [[ $name =~ $NAME_RE ]]; then log "baris $n diabaikan: username tidak valid"; continue; fi
		if ! [[ $uid =~ ^[0-9]{5}$ ]] || ((uid < UID_MIN || uid > UID_MAX)); then log "baris $n diabaikan: uid tidak valid"; continue; fi
		if [ -n "$hash" ] && ! [[ $hash =~ $HASH_RE ]]; then log "baris $n diabaikan: hash tidak valid"; continue; fi
		if [ -n "$rest" ]; then log "baris $n diabaikan: kolom berlebih"; continue; fi
		cur_uid=$(id -u "$name" 2>/dev/null) || cur_uid=''
		cur_name=$(getent passwd "$uid" | cut -d: -f1)
		if [ -n "$cur_uid" ] && [ "$cur_uid" != "$uid" ]; then log "baris $n diabaikan: $name sudah ada dengan uid lain"; continue; fi
		if [ -n "$cur_name" ] && [ "$cur_name" != "$name" ]; then log "baris $n diabaikan: uid $uid dipakai $cur_name"; continue; fi
		if [ -z "$cur_uid" ]; then
			getent group "$uid" >/dev/null || groupadd -g "$uid" "$name" || { log "groupadd $name gagal"; continue; }
			useradd -M -u "$uid" -g "$uid" -s /bin/bash -d "/home/$name" "$name" || { log "useradd $name gagal"; continue; }
			log "akun $name dibuat"
		fi
		printf '%s:%s\n' "$name" "${hash:-!}" | chpasswd -e || log "chpasswd $name gagal"
		[ -d "/home/$name" ] || install -d -m 0700 -o "$uid" -g "$uid" "/home/$name"
		want[$name]=1
	done < <(cat "$ACCOUNTS" 2>/dev/null)
	# akun yang tidak ada lagi di berkas: putus sesinya, hapus akunnya, simpan home-nya
	local users u
	mapfile -t users < <(getent passwd)
	for u in "${users[@]}"; do
		IFS=: read -r name _ uid _ <<<"$u"
		((uid >= UID_MIN && uid <= UID_MAX)) || continue
		[ -n "${want[$name]:-}" ] && continue
		pkill -KILL -u "$uid" 2>/dev/null
		if userdel -f "$name" 2>/dev/null; then log "akun $name dihapus"; else log "userdel $name gagal"; fi
	done
}

if [ "${1:-}" = --loop ]; then
	# sinkron saat berkas berubah, dan tiap ±30 dtk supaya kegagalan sesaat (mis. userdel) diulang
	last='' ticks=0
	while :; do
		cur=$(cksum "$ACCOUNTS" 2>/dev/null) || cur=''
		if [ "$cur" != "$last" ] || ((ticks >= 15)); then sync_once; last=$cur; ticks=0; fi
		ticks=$((ticks + 1))
		sleep 2
	done
else
	sync_once
fi
