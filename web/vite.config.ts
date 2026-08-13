import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Im Dev-Modus gehen alle /api-Anfragen an den Express-Server.
// PORT gehoert dem Frontend, FLNS_PORT dem Backend – so kollidieren sie nicht,
// auch wenn ein Runner PORT von aussen setzt.
const uiPort = Number(process.env.PORT) || 5273;
const apiPort = Number(process.env.FLNS_PORT) || 4100;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Ohne explizite Bindung loest Node "localhost" je nach System zu ::1 auf und
    // Vite lauscht dann nur auf IPv6 – 127.0.0.1 laeuft ins Leere. Fuer Zugriff
    // von anderen Rechnern: npm run dev -- --host
    host: '127.0.0.1',
    port: uiPort,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
});
