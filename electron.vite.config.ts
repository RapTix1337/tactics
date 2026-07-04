import { resolve } from 'node:path';

import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

// Entry points are set explicitly: the repo follows the ADR-026 layout
// (src/app + src/modules → main, src/app/preload → preload, src/ui →
// renderer), not the electron-vite template conventions.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/app/main.ts'),
        },
        output: {
          format: 'es',
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/app/preload/index.ts'),
        },
        output: {
          // Sandboxed preload scripts (ADR-025) cannot be ES modules.
          format: 'cjs',
        },
      },
    },
  },
  renderer: {
    root: 'src/ui',
    build: {
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/ui/index.html'),
        },
      },
    },
  },
});
