import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 8260,
    host: true,
    proxy: { '/ws': { target: 'ws://localhost:8261', ws: true } },
  },
  preview: { port: 8262 },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
