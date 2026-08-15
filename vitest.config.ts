import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// Ein Runner fuer beide Seiten: Das Backend ist reines ESM-JavaScript, das
// Frontend TypeScript – vitest kann beides ohne Zusatzschritt.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./web/src', import.meta.url)),
    },
  },
  test: {
    include: ['server/**/*.test.js', 'web/src/**/*.test.ts'],
    environment: 'node',
    reporters: 'default',
  },
});
