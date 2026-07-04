import { defineConfig } from '@playwright/test';

// E2E config (ADR-034 spike, E4.1). Electron ships its own Chromium, so no
// Playwright browser install is needed. `retries: 0` is deliberate: the spike
// measures flakiness across CI runs — retries would mask exactly the signal
// the pass criteria ask for.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  forbidOnly: process.env['CI'] !== undefined,
  reporter: 'list',
});
