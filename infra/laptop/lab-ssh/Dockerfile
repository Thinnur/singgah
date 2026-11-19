# Singgah: container lab ("VM target" .10 tiap lab) dengan SSH. Dijalankan oleh s5-labs (container-run), jaringan dari netns lab.
FROM debian:trixie-slim
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      openssh-server iproute2 iputils-ping curl nano vim-tiny less procps python3 \
 && rm -rf /var/lib/apt/lists/* /etc/ssh/ssh_host_* \
 && mkdir -p /run/sshd /etc/ssh/hostkeys \
 # pam_loginuid butuh CAP_AUDIT_CONTROL yang sengaja tidak diberikan; tanpa ini semua login ditolak
 && sed -i 's/^session\s\+required\s\+pam_loginuid.so/session optional pam_loginuid.so/' /etc/pam.d/sshd \
 # satu mahasiswa tidak boleh menghabiskan --pids-limit container (pam_limits ada di PAM sshd Debian; tidak berlaku untuk root)
 && printf '%s\n' '*  hard  nproc  64' > /etc/security/limits.d/singgah.conf \
 && printf '%s\n' 'Container lab Singgah.' 'Hanya isi /home yang tersimpan; berkas di luar /home hilang saat container dibuat ulang.' > /etc/motd
COPY sshd-singgah.conf /etc/ssh/sshd_config.d/singgah.conf
COPY entrypoint.sh sync-accounts.sh /usr/local/sbin/
RUN chmod 755 /usr/local/sbin/entrypoint.sh /usr/local/sbin/sync-accounts.sh
EXPOSE 22
ENTRYPOINT ["/usr/local/sbin/entrypoint.sh"]
