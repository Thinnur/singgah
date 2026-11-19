#!/bin/bash
# Singgah: uji image container lab (akun SSH) tanpa menyentuh lab produksi. Jalankan sebagai root di laptop gateway:
#   sudo bash test-image.sh <path s5-labs> <direktori lab-ssh>
# Memakai tag singgah-lab-ssh:test dan container s5-lab-imgtest berjaringan none; login diuji dari host lewat nsenter.
set -uo pipefail
[ "$EUID" = 0 ] || { echo "jalankan sebagai root" >&2; exit 2; }
[ $# = 2 ] || { echo "pakai: $0 <path s5-labs> <direktori lab-ssh>" >&2; exit 2; }
command -v sshpass >/dev/null || { echo "sshpass belum terpasang (apt-get install sshpass)" >&2; exit 2; }
S5LABS=$1 CTX=$2
export S5_LAB_IMAGE=singgah-lab-ssh:test
NAME=s5-lab-imgtest HOST=lab-imgtest
T=$(mktemp -d) fail=0 PID=''

ok()  { echo "PASS  $*"; }
bad() { echo "FAIL  $*"; fail=1; }
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1; rm -rf "$T"; }
trap cleanup EXIT

waitfor() { local end=$((SECONDS + $1)); shift; until "$@" >/dev/null 2>&1; do [ $SECONDS -lt $end ] || return 1; sleep 0.5; done; }
inc() { docker exec "$NAME" "$@"; }
listening() { nsenter -t "$PID" -n bash -c '</dev/tcp/127.0.0.1/22'; }
sshc() {   # sshc <user> <password> [opsi ssh...] -- <perintah...>
	local u=$1 p=$2 opts=(); shift 2
	while [ $# -gt 0 ] && [ "$1" != -- ]; do opts+=("$1"); shift; done; shift
	nsenter -t "$PID" -n env SSHPASS="$p" sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
		-o ConnectTimeout=4 -o PubkeyAuthentication=no -o PreferredAuthentications=password -o LogLevel=ERROR \
		"${opts[@]}" "$u@127.0.0.1" "$@"
}
accounts() { printf '%s' "$1" > "$T/acc/accounts.tmp"; chmod 644 "$T/acc/accounts.tmp"; mv "$T/acc/accounts.tmp" "$T/acc/accounts"; }
start() {
	docker rm -f "$NAME" >/dev/null 2>&1
	bash "$S5LABS" container-run "$NAME" "$HOST" "$T/acc" "$T/home" "$T/keys" >/dev/null || return 1
	PID=$(docker inspect -f '{{.State.Pid}}' "$NAME") && waitfor 10 listening
}
fingerprint() { nsenter -t "$PID" -n ssh-keyscan -t ed25519 127.0.0.1 2>/dev/null | awk '{print $3}'; }
is() { [ "$("${@:2}" 2>/dev/null)" = "$1" ]; }   # is <harapan> <perintah...>: stdout sama persis

install -d -m 0755 "$T/acc" "$T/home"; install -d -m 0700 "$T/keys"
docker build -q -t "$S5_LAB_IMAGE" "$CTX" >/dev/null || { bad "docker build $CTX"; exit 1; }
start || { bad "container-run / sshd tidak mendengarkan port 22 dalam 10 dtk"; docker logs "$NAME" 2>&1 | tail -20; exit 1; }
ok "container jalan, sshd mendengarkan port 22"

H1=$(printf %s pw-satu | openssl passwd -6 -stdin)
ROOT_SHADOW=$(inc getent shadow root | cut -d: -f2)
accounts "alice:10001:$H1
root:0:$H1
bob;x:10002:
carol:10003:bukanhash
dave:10004:
eve:09000:
frank:00029:
"
# 1. sinkron akun dari berkas
if waitfor 6 is 10001 inc id -u alice; then ok "1. akun valid alice dibuat (uid 10001)"; else bad "1. alice tidak dibuat dalam 6 dtk"; fi
if is "$H1" inc bash -c 'getent shadow alice | cut -d: -f2'; then ok "1. hash password alice terpasang"; else bad "1. hash alice salah"; fi
if is "700 10001" inc stat -c '%a %u' /home/alice; then ok "1. /home/alice 0700 milik 10001"; else bad "1. /home/alice: $(inc stat -c '%a %u' /home/alice 2>&1)"; fi
if is "$ROOT_SHADOW" inc bash -c 'getent shadow root | cut -d: -f2'; then ok "1. baris root:0 diabaikan (shadow root tetap)"; else bad "1. shadow root berubah"; fi
if ! inc id carol >/dev/null 2>&1 && ! inc id bob >/dev/null 2>&1; then ok "1. baris tidak valid (bob;x, hash bukan crypt) diabaikan"; else bad "1. akun dari baris tidak valid dibuat"; fi
if inc bash -c 'getent shadow dave | cut -d: -f2 | grep -q "^!"'; then ok "1. akun tanpa hash (dave) dikunci"; else bad "1. dave tidak dikunci"; fi
if ! inc id eve >/dev/null 2>&1 && ! inc id frank >/dev/null 2>&1; then ok "1. uid berawalan nol (09000, 00029) diabaikan"; else bad "1. akun dengan uid berawalan nol dibuat"; fi

# 2. login SSH
if is "$HOST" sshc alice pw-satu -- hostname; then ok "2. login alice dengan password, hostname $HOST"; else bad "2. login alice gagal"; fi
if sshc alice salah -- true 2>/dev/null; then bad "2. password salah diterima"; else ok "2. password salah ditolak"; fi
if sshc root pw-satu -- true 2>/dev/null; then bad "2. login root diterima"; else ok "2. login root ditolak"; fi
if sshc alice pw-satu -- ping -c 1 -W 2 127.0.0.1 >/dev/null; then ok "2. user bisa ping tanpa NET_RAW"; else bad "2. ping dari akun user gagal"; fi
if is 64 sshc alice pw-satu -- ulimit -u; then ok "2. batas proses per user 64 (fork bomb tidak menghabiskan container)"; else bad "2. ulimit -u alice bukan 64: $(sshc alice pw-satu -- ulimit -u 2>&1)"; fi
if is "1 1" inc bash -c 'cat /proc/sys/net/ipv6/conf/all/disable_ipv6 /proc/sys/net/ipv6/conf/default/disable_ipv6 | xargs'; then ok "2. IPv6 mati di container (tidak ada jalur link-local ke laptop)"; else bad "2. IPv6 masih aktif di container"; fi

# 3. tanpa sudo, tanpa port forwarding
if sshc alice pw-satu -- command -v sudo >/dev/null; then bad "3. sudo tersedia"; else ok "3. sudo tidak tersedia"; fi
FWD=$(timeout 10 nsenter -t "$PID" -n env SSHPASS=pw-satu sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
	-o PubkeyAuthentication=no -o LogLevel=ERROR -W 127.0.0.1:22 alice@127.0.0.1 </dev/null 2>&1); rc=$?
if [ $rc != 0 ] && [[ $FWD == *prohibited* || $FWD == *"open failed"* || $FWD == *"forwarding failed"* ]]; then ok "3. port forwarding (ssh -W) ditolak server"; else bad "3. port forwarding tidak ditolak (rc $rc): ${FWD:0:80}"; fi

# 4. dihapus dari berkas -> sesi dimatikan, akun hilang, home tetap
FP1=$(fingerprint)
sshc alice pw-satu -- sleep 60 >/dev/null 2>&1 & SPID=$!
waitfor 6 inc pgrep -u alice sleep || bad "4. sesi sleep alice tidak terlihat"
accounts ""
if waitfor 6 bash -c "! docker exec $NAME id alice"; then ok "4. alice dihapus dari berkas: akun hilang"; else bad "4. alice masih ada setelah 6 dtk"; fi
if waitfor 6 bash -c "! kill -0 $SPID"; then ok "4. sesi alice yang berjalan diputus"; else bad "4. sesi alice masih hidup"; kill $SPID 2>/dev/null; fi
if inc test -d /home/alice; then ok "4. /home/alice tetap tersimpan"; else bad "4. /home/alice terhapus"; fi
docker exec -d -u 10001:10001 "$NAME" sleep 300
if waitfor 40 bash -c "! docker exec $NAME pgrep -u 10001"; then ok "4. proses yatim uid 10001 (akun sudah dihapus) dimatikan"; else bad "4. proses yatim uid 10001 masih hidup setelah 40 dtk"; fi

# 5. container dibuat ulang -> host key sama, akun dan pemilik home kembali
accounts "alice:10001:$H1
"
start || { bad "5. container dibuat ulang tidak jalan"; exit 1; }
if [ -n "$FP1" ] && is "$FP1" fingerprint; then ok "5. host key sama setelah container dibuat ulang"; else bad "5. host key berubah"; fi
if waitfor 6 is "$HOST" sshc alice pw-satu -- hostname; then ok "5. alice login lagi setelah container dibuat ulang"; else bad "5. alice tidak bisa login setelah dibuat ulang"; fi
if is "700 10001" inc stat -c '%a %u' /home/alice; then ok "5. /home/alice tetap milik 10001"; else bad "5. pemilik /home/alice berubah"; fi

[ $fail = 0 ] && echo "SEMUA LULUS" || { echo "ADA YANG GAGAL"; docker logs "$NAME" 2>&1 | tail -20; }
exit $fail
