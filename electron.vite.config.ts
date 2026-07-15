import { resolve } from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import type { Plugin } from 'vite';

import { PROD_CONTENT_SECURITY_POLICY } from './src/app/lifecycle/security-policy';

// Injects the strict production CSP as a <meta> tag into the built renderer
// HTML: packaged windows load via file://, which carries no HTTP headers, so
// onHeadersReceived cannot enforce a policy there. Build-only — the dev
// server gets the (relaxed) dev CSP as a response header instead
// (src/app/lifecycle: security-policy.ts, app-lifecycle.ts; ADR-039).
function injectProductionCsp(): Plugin {
  return {
    name: 'tactics:inject-production-csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: PROD_CONTENT_SECURITY_POLICY,
          },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

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
    resolve: {
      // shadcn/ui alias (tsconfig.web.json `paths`, components.json).
      alias: {
        '@': resolve(import.meta.dirname, 'src/ui'),
      },
    },
    plugins: [react(), tailwindcss(), injectProductionCsp()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/ui/index.html'),
          // Second renderer entry: the overlay window (ADR-058; the OVL.4
          // stub until OVL.7 lands the real entry).
          overlay: resolve(import.meta.dirname, 'src/ui/overlay.html'),
        },
      },
    },
  },
});
