import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';

// ADR-034 spike (E4.1): launches the built app with env overrides and asserts
// the stable renderer selector. Pass criteria evidenced here:
//   (1) app start with env overrides — separate user-data dir verified in the
//       main process,
//   (2) stable renderer selector — data-testid="app-root" (src/ui/App.tsx),
//   (3) no flaking across 20 CI runs — this file runs once per CI run with
//       retries disabled (playwright.config.ts).
const MAIN_BUNDLE = resolve(import.meta.dirname, '../../out/main/index.js');

// Local helper, so the return type is inferred — the eslint config lints
// tests/ without the TS parser, which cannot read type-only syntax.
async function launchBuiltApp() {
  if (!existsSync(MAIN_BUNDLE)) {
    throw new Error(`Built main bundle missing at ${MAIN_BUNDLE} — run \`pnpm build\` first.`);
  }

  const userDataDir = await mkdtemp(join(tmpdir(), 'tactics-e2e-'));
  const electronApp = await electron.launch({
    args: [MAIN_BUNDLE],
    env: { ...process.env, TACTICS_USER_DATA_DIR: userDataDir },
  });

  return {
    electronApp,
    userDataDir,
    close: async () => {
      await electronApp.close();
      await rm(userDataDir, { recursive: true, force: true });
    },
  };
}

test('built app starts with a separate user-data dir and renders the app root', async () => {
  const { electronApp, userDataDir, close } = await launchBuiltApp();

  try {
    // Pass criterion 1: the override reached the main process. realpath
    // normalizes Windows 8.3 short paths (GitHub runners hand out a
    // short-path temp dir), which would otherwise fail a string compare.
    const effectiveUserDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    expect(await realpath(effectiveUserDataDir)).toBe(await realpath(userDataDir));

    // Pass criterion 2: the stable renderer selector is visible.
    const window = await electronApp.firstWindow();
    await expect(window.getByTestId('app-root')).toBeVisible();

    // E5.4: the snapshot round trip works in the real app — and again
    // after a reload, proving stores re-initialize per renderer context.
    await expect(window.getByTestId('ipc-status')).toHaveText('IPC: ready');
    await window.reload();
    await expect(window.getByTestId('ipc-status')).toHaveText('IPC: ready');
  } finally {
    await close();
  }
});

// E6.2 acceptance criterion: the whole escalation chain — window.onerror →
// app.reportRendererError → main log line under the renderer scope — proven
// against the built app; every link is unit-tested individually.
test('a thrown renderer error reaches the main log under the renderer scope', async () => {
  const { electronApp, userDataDir, close } = await launchBuiltApp();

  try {
    const window = await electronApp.firstWindow();
    await expect(window.getByTestId('ipc-status')).toHaveText('IPC: ready');

    // setTimeout, so the throw escapes evaluate() and hits window.onerror
    // as a genuine uncaught error.
    await window.evaluate(() => {
      setTimeout(() => {
        throw new Error('E2E renderer error probe');
      }, 0);
    });

    const logFile = join(userDataDir, 'logs', 'main.log');
    await expect
      .poll(async () => (existsSync(logFile) ? await readFile(logFile, 'utf8') : ''), {
        timeout: 10_000,
      })
      .toMatch(/\[error\] \[renderer\] Error: E2E renderer error probe/);
  } finally {
    await close();
  }
});
