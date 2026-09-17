/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      config: src('config'),
      components: src('components'),
      pages: src('pages'),
      assets: src('assets'),
      hooks: src('hooks'),
      store: src('store'),
      utils: src('utils'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
  build: {
    rollupOptions: {
      output: {
        // Bibliotecas em chunks proprios: mudar o codigo do app nao invalida
        // o cache delas no browser.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          socket: ['socket.io-client'],
          http: ['axios'],
        },
      },
    },
  },
  css: {
    preprocessorOptions: {
      scss: { api: 'modern' },
    },
  },
});
