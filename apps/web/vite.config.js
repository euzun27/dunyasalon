import { defineConfig } from 'vite';

// Geliştirmede /api istekleri yerel sunucuya (Hono + SQLite) yönlendirilir.
export default defineConfig({
  server: {
    port: 5173,
    proxy: { '/api': process.env.API_TARGET ?? 'http://localhost:8787' },
  },
  build: { outDir: 'dist', target: 'es2022' },
});
