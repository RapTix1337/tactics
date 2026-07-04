import { defineConfig } from 'vitest/config';

// Vitest cannot consume electron.vite.config.ts (electron-vite's defineConfig
// returns the three-target main/preload/renderer shape), so unit-test config
// lives here. The renderer has no Vite plugins yet — when React lands (E3.2),
// the "ui" project adds @vitejs/plugin-react and the RTL setup file.
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
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['src/ui/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
});
