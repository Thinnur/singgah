# Singgah

Portal VPN WireGuard swadaya untuk lab: pengguna masuk dengan email UGM, mengajukan akses ke sebuah lab selama 1, 2, atau 4 jam, lalu mendapat konfigurasi WireGuard. Worker mencabut akses otomatis saat lease berakhir.

Backend Node.js 24 + TypeScript (Fastify, `node:sqlite`); frontend React menyusul.

## Struktur repo

- `backend/` : API dan worker (TypeScript dijalankan langsung oleh Node).
- `docs/` : PRD, desain (`design.md`), rencana (`plan.md`), diagram alur.
- `infra/vps/` : konfigurasi relay di VPS (nftables, systemd, Tailscale).
- `infra/laptop/` : salinan skrip dan konfigurasi gateway di laptop (`wg0.conf.example` tanpa private key).

## Perintah

```
npm test
npm run typecheck
```

Petunjuk instalasi menyusul.
