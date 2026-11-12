# Relay VPS

Langkah pemasangan:

1. Gabungkan ke Tailscale: `tailscale up --accept-dns=false --hostname=s5-relay-vps`
2. Buka firewall: `ufw allow 41641/udp`
3. Autoload modul kernel dinonaktifkan di VPS ini, jadi isi `/etc/modules-load.d/tailscale.conf` dengan:
   ```
   xt_mark
   xt_connmark
   ```
4. Salin `s5-relay.nft` ke `/etc/s5-relay.nft` dan `s5-relay.service` ke `/etc/systemd/system/`, lalu `systemctl enable --now s5-relay`.
