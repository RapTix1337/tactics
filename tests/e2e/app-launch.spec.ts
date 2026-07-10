import { existsSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { dismissSetupOfferIfOpen } from './dismiss-setup-offer';
import { launchBuiltApp } from './launch-built-app';

// ADR-034 spike (E4.1): launches the built app with env overrides and asserts
// the stable renderer selector. Pass criteria evidenced here:
//   (1) app start with env overrides — separate user-data dir verified in the
//       main process,
//   (2) stable renderer selector — data-testid="app-root" (src/ui/App.tsx),
//   (3) no flaking across 20 CI runs — this file runs once per CI run with
//       retries disabled (playwright.config.ts).
// The launch helper moved to launch-built-app.ts when E14.1 added a second
// spec.

test('built app starts with a separate user-data dir and renders the app root', async () => {
  const { electronApp, userDataDir, close } = await launchBuiltApp();

  try {
    // Pass criterion 2 first: the stable renderer selector is visible. The
    // window doubles as the startup barrier — a main-process evaluate issued
    // straight after launch() races app startup, whose module loading
    // destroys the execution context Playwright bound at launch time
    // ("Execution context was destroyed"). Once the window exists, startup
    // is over and the evaluate below is safe.
    const window = await electronApp.firstWindow();
    await expect(window.getByTestId('app-root')).toBeVisible();

    // Pass criterion 1: the override reached the main process. realpath
    // normalizes Windows 8.3 short paths (GitHub runners hand out a
    // short-path temp dir), which would otherwise fail a string compare.
    const effectiveUserDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    expect(await realpath(effectiveUserDataDir)).toBe(await realpath(userDataDir));

    // E5.4: the snapshot round trip works in the real app — and again
    // after a reload, proving stores re-initialize per renderer context.
    // The app home is the maps overview (E22.4) while the ipc-status
    // selector lives on the live page, so navigate there first.
    await dismissSetupOfferIfOpen(window);
    await window.getByRole('link', { name: 'Live' }).click();
    await expect(window.getByTestId('ipc-status')).toHaveText('IPC: ready');

    await window.reload();
    await dismissSetupOfferIfOpen(window);
    await window.getByRole('link', { name: 'Live' }).click();
    await expect(window.getByTestId('ipc-status')).toHaveText('IPC: ready');

    // E8.3: storage is wired at startup — a ready snapshot implies the
    // database was opened and migrated in the overridden user-data dir.
    expect(existsSync(join(userDataDir, 'tactics.db'))).toBe(true);
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
    // The app now starts on the maps overview (E22.4); a rendered app root
    // proves main.tsx ran, which installs the error capture before render.
    await expect(window.getByTestId('app-root')).toBeVisible();

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
