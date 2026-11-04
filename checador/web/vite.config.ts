import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const raiz = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: raiz,
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    host: true,
    proxy: { '/api': `http://localhost:${process.env.PORT ?? 3100}` },
  },
});
