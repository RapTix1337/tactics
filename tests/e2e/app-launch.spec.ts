import { existsSync } from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
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

test('built app starts with a separate user-data dir and renders the app root', async () => {
  if (!existsSync(MAIN_BUNDLE)) {
    throw new Error(`Built main bundle missing at ${MAIN_BUNDLE} — run \`pnpm build\` first.`);
  }

  const userDataDir = await mkdtemp(join(tmpdir(), 'tactics-e2e-'));
  const electronApp = await electron.launch({
    args: [MAIN_BUNDLE],
    env: { ...process.env, TACTICS_USER_DATA_DIR: userDataDir },
  });

  try {
    // Pass criterion 1: the override reached the main process. realpath
    // normalizes Windows 8.3 short paths (GitHub runners hand out a
    // short-path temp dir), which would otherwise fail a string compare.
    const effectiveUserDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    expect(await realpath(effectiveUserDataDir)).toBe(await realpath(userDataDir));

    // Pass criterion 2: the stable renderer selector is visible.
    const window = await electronApp.firstWindow();
    await expect(window.getByTestId('app-root')).toBeVisible();
  } finally {
    await electronApp.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
