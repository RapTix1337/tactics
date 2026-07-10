import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { dismissSetupOfferIfOpen } from './dismiss-setup-offer';
import { isPortFree, postToIntake } from './intake-probe';
import { launchBuiltApp } from './launch-built-app';

// E20.1 test mode: env overrides give the E2E suite a stable, isolated app
// under test — separate user-data dirs (E4.1), a fixed GSI port, disabled
// update checks, and a pre-seeded fixture profile (ADR-045). The scenarios
// here evidence the acceptance criteria; the browse/live scenario suite on
// top of them lives in smoke-scenarios.spec.ts (E20.2).

/**
 * A random free port whose successor is also free — the fallback-chain
 * scenario below needs two adjacent bindable ports. Deliberately not an
 * OS-assigned `listen(0)` port: Windows hands out ephemeral ports
 * sequentially, so the successor of a just-released one is routinely taken
 * by the next process (observed: an Electron DevTools listener answering
 * 400). The 43xxx range sits outside the ephemeral range and clear of any
 * dev instance's default GSI chain (42730–42739).
 */
async function reserveAdjacentPorts(): Promise<number> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const base = 43_000 + Math.floor(Math.random() * 2_000);
    if ((await isPortFree(base)) && (await isPortFree(base + 1))) {
      return base;
    }
  }
  throw new Error('no adjacent free port pair found');
}

test('two parallel instances on the same fixed GSI port do not collide', async () => {
  const basePort = await reserveAdjacentPorts();
  const env = { TACTICS_GSI_PORT: String(basePort) };
  const first = await launchBuiltApp({ env });
  const second = await launchBuiltApp({ env });

  try {
    // Both windows render: neither the single-instance lock (own user-data
    // dirs) nor the fixed port (ADR-031 fallback chain) collided.
    await expect((await first.electronApp.firstWindow()).getByTestId('app-root')).toBeVisible();
    await expect((await second.electronApp.firstWindow()).getByTestId('app-root')).toBeVisible();

    // Both intakes listen — on the fixed port and its chain successor. A
    // token-less POST answers 401, which proves a listener without needing
    // the instance's auth token; 0 (nothing bound) keeps the poll retrying.
    await expect.poll(() => postToIntake(basePort, '{}'), { timeout: 10_000 }).toBe(401);
    await expect.poll(() => postToIntake(basePort + 1, '{}'), { timeout: 10_000 }).toBe(401);
  } finally {
    await second.close();
    await first.close();
  }
});

test('test mode disables update checks — the no-op updater logs the skip', async () => {
  // The launch helper always sets TACTICS_DISABLE_UPDATES; the skip line is
  // logged at debug level, so the log override joins in.
  const { electronApp, userDataDir, close } = await launchBuiltApp({
    env: { TACTICS_LOG_DEBUG: '1' },
  });

  try {
    await expect((await electronApp.firstWindow()).getByTestId('app-root')).toBeVisible();

    // start() checks immediately (E18.1), so the skip is logged at startup.
    const logFile = join(userDataDir, 'logs', 'main.log');
    await expect
      .poll(async () => (existsSync(logFile) ? await readFile(logFile, 'utf8') : ''), {
        timeout: 10_000,
      })
      .toMatch(/Update check skipped \(unpackaged build or disabled\)/);
  } finally {
    await close();
  }
});

test('a pre-seeded fixture profile is served through the real app', async () => {
  const { electronApp, close } = await launchBuiltApp({ seedFixtureProfile: true });

  try {
    const window = await electronApp.firstWindow();
    await expect(window.getByTestId('app-root')).toBeVisible();

    await dismissSetupOfferIfOpen(window);

    // The overview card flips from "upload" to "view": the app read the
    // seeded database through its own migration check and repository.
    await expect(window.getByRole('link', { name: 'View map Dust 2' })).toBeVisible();
    await expect(window.getByRole('button', { name: 'Upload image… for Dust 2' })).toHaveCount(0);
  } finally {
    await close();
  }
});
