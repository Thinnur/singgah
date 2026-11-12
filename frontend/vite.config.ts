import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // `npm run dev` proxies API calls to a locally running singgah-api.
  server: { proxy: { '/api': 'http://localhost:8780', '/auth': 'http://localhost:8780' } },
});
