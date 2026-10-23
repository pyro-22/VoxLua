import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the built app also loads from file:// (Electron).
  base: './',
  worker: { format: 'es' },
  // A local tool ships as one bundle; no need to warn about its size.
  build: { chunkSizeWarningLimit: 1500 },
  server: { port: 5173, strictPort: true },
});
