import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Carrega o .env.test antes de qualquer import do app.
    setupFiles: ['./tests/env.ts'],
    globalSetup: ['./tests/setup.ts'],
    // Os testes compartilham um banco SQLite: rodar em paralelo daria lock.
    fileParallelism: false,
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
  },
});
