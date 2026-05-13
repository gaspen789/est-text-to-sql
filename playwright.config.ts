import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/*.spec.ts'],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list'], ['html']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev -w frontend -- --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    // Keep E2E deterministic: always run with the env overrides below.
    reuseExistingServer: false,
    env: {
      // We intentionally point the frontend API base at a non-existent origin.
      // Playwright tests intercept and fulfill all API requests (no real backend/DB).
      VITE_API_URL: 'http://127.0.0.1:3999',
    },
  },
});

