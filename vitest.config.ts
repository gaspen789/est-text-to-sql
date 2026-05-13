import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'frontend/src'),
    },
  },
  test: {
    include: [
      'e2e/contracts/**/*.test.ts',
      'frontend/src/**/*.test.ts',
      'frontend/src/**/*.test.tsx',
    ],
    environment: 'node',
  },
});

