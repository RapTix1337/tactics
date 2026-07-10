import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Vitest cannot consume electron.vite.config.ts (electron-vite's defineConfig
// returns the three-target main/preload/renderer shape), so unit-test config
// lives here.
//
// Includes are limited to src/ (colocated *.test.ts(x), CLAUDE.md §7);
// tests/ holds only E2E tests and fixtures and is excluded structurally.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/{app,modules,shared}/**/*.test.{ts,tsx}'],
        },
      },
      {
        plugins: [react()],
        resolve: {
          // shadcn/ui alias (tsconfig.web.json `paths`, components.json).
          alias: {
            '@': resolve(import.meta.dirname, 'src/ui'),
          },
        },
        test: {
          name: 'ui',
          environment: 'jsdom',
          setupFiles: ['./src/ui/test-setup.ts'],
          include: ['src/ui/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
});
