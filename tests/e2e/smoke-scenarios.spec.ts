import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import { dismissSetupOfferIfOpen } from './dismiss-setup-offer';
import { isPortFree, postToIntake } from './intake-probe';
import { launchBuiltApp } from './launch-built-app';
import { FIXTURE_GSI_TOKEN } from './seed-fixture-profile';

// The E20.2 release-blocking smoke suite (10-testing.md §1.3): the thin
// scenario set over the real built app in test mode. Scenario 1 (app
// launches, window appears) lives in app-launch.spec.ts since the ADR-034
// spike — not repeated here. Scenarios in this file:
//   2. browse mode — a pre-seeded fixture profile opens from the sidebar,
//      callouts visible;
//   3. change theme + restart → persisted;
//   4. the fresh-start GSI status is visible with its diagnostic;
//   5. a posted fixture payload switches the live view to the played map.

const MID_MATCH_PAYLOAD = resolve(
  import.meta.dirname,
  '../fixtures/gsi/real/03-mid-match/001.json',
);

/** A random free port outside the ephemeral range (see test-mode.spec.ts). */
async function reserveFreePort(): Promise<number> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const port = 43_000 + Math.floor(Math.random() * 2_000);
    if (await isPortFree(port)) {
      return port;
    }
  }
  throw new Error('no free port found');
}

/** `firstWindow` plus the app-root startup barrier every scenario needs. */
async function firstWindow(
  electronApp: Awaited<ReturnType<typeof launchBuiltApp>>['electronApp'],
): Promise<Page> {
  const window = await electronApp.firstWindow();
  await expect(window.getByTestId('app-root')).toBeVisible();
  return window;
}

// Scenario 2: the seeded profile reaches the browse view through the real
// stack — sidebar navigation, profile repository, tactics-map:// image
// delivery, and the callout layer (E14.4).
test('browse mode: a seeded map opens from the sidebar with callouts visible', async () => {
  const { electronApp, close } = await launchBuiltApp({ seedFixtureProfile: true });

  try {
    const window = await firstWindow(electronApp);
    await dismissSetupOfferIfOpen(window);

    // Exact: with a seeded profile the overview card also links to Dust 2
    // ("View map Dust 2"); the sidebar entry is named exactly "Dust 2".
    await window.getByRole('link', { name: 'Dust 2', exact: true }).click();

    const image = window.getByTestId('map-view-image');
    await expect(image).toBeVisible();
    // naturalWidth > 0 proves the bytes arrived over tactics-map:// and
    // passed the CSP (the map-image-rendering.spec criterion).
    await expect.poll(() => image.evaluate((element) => element.naturalWidth)).toBeGreaterThan(0);
    // One default-layout callout stands in for the layer (data/maps/de_dust2).
    await expect(window.getByText('T Spawn', { exact: true })).toBeVisible();
  } finally {
    await close();
  }
});

// Scenario 3: theme changes persist across a restart (E16.1 acceptance —
// settings.update through the real command path, re-read from the same
// user-data directory by a second app instance).
test('a theme change survives a restart', async () => {
  const first = await launchBuiltApp();
  let restarted: Awaited<ReturnType<typeof launchBuiltApp>> | undefined;

  try {
    const window = await firstWindow(first.electronApp);
    await dismissSetupOfferIfOpen(window);

    // Dark is the binding default (UI-04) — switching to Light is what makes
    // the restarted instance prove persistence rather than the default.
    await expect
      .poll(() => window.evaluate('document.documentElement.classList.contains("dark")'))
      .toBe(true);

    await window.getByRole('link', { name: 'Settings' }).click();
    await window.getByLabel('Theme').click();
    await window.getByRole('option', { name: 'Light' }).click();
    // Exact: the settings page also has the GSI port section's "Save port".
    await window.getByRole('button', { name: 'Save', exact: true }).click();
    // The round trip is done once the theme application reacted to the
    // store-applied evt:settings.changed (ADR-033 — no optimistic UI).
    await expect
      .poll(() => window.evaluate('document.documentElement.classList.contains("dark")'))
      .toBe(false);

    await first.electronApp.close();

    restarted = await launchBuiltApp({ userDataDir: first.userDataDir });
    const reopened = await firstWindow(restarted.electronApp);
    await dismissSetupOfferIfOpen(reopened);
    await expect
      .poll(() => reopened.evaluate('document.documentElement.classList.contains("dark")'))
      .toBe(false);
  } finally {
    // Both instances share one user-data dir, so cleanup is manual here:
    // close whatever is still running, then remove the directory once.
    await first.electronApp.close().catch(() => undefined);
    await restarted?.electronApp.close().catch(() => undefined);
    await rm(first.userDataDir, { recursive: true, force: true });
  }
});

// Scenario 4: a fresh start surfaces the GSI status with its diagnostic
// (GSI-05). Which unconfigured status shows depends on the machine, not the
// isolated user-data dir: no CS2 known → `not-set-up`; a detected CS2 →
// the startup verify compares against this instance's fresh token and lands
// on `repair-needed`. CI runners have no Steam, so there the scenario pins
// the plan's literal "Not set up".
test('a fresh start shows the unconfigured GSI status with its diagnostic', async () => {
  const { electronApp, close } = await launchBuiltApp();

  try {
    const window = await firstWindow(electronApp);

    const gsiBadge = window.getByRole('status', { name: 'GSI connection status' });
    await expect(gsiBadge).not.toHaveText('');
    const badgeText = await gsiBadge.innerText();

    if (process.env['CI'] !== undefined) {
      expect(badgeText).toContain('Not set up');
    }
    if (badgeText.includes('Not set up')) {
      await expect(gsiBadge).toContainText('Game State Integration is not set up yet.');
      // The first-start offer auto-opened exactly for this status (E15.2);
      // dismissed, setup stays one click away in the sidebar panel.
      await window.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
      await expect(window.getByRole('button', { name: 'Set up now' })).toBeVisible();
    } else {
      await expect(gsiBadge).toContainText('Repair needed');
      await expect(gsiBadge).toContainText('The GSI config file is missing or outdated.');
      await expect(window.getByRole('button', { name: 'Repair now' })).toBeVisible();
    }
  } finally {
    await close();
  }
});

// Scenario 5: the core loop end to end — a seeded valid GSI setup boots the
// app into `waiting`, a posted real mid-match payload (fixture corpus,
// carrying the seeded token) drives the status machine to `connected`, and
// the live view switches to the played map with its callouts (ADR-028: the
// view renders 1:1 from the game-state store, no navigation involved).
test('a posted GSI payload switches the live view to the played map', async () => {
  const port = await reserveFreePort();
  const { electronApp, close } = await launchBuiltApp({
    seedFixtureProfile: true,
    gsiSetupPort: port,
  });

  try {
    const window = await firstWindow(electronApp);

    // The seeded setup verified ok at startup — no offer dialog, `waiting`.
    const gsiBadge = window.getByRole('status', { name: 'GSI connection status' });
    await expect(gsiBadge).toContainText('Waiting for data');

    await window.getByRole('link', { name: 'Live' }).click();
    await expect(window.getByText('No game detected')).toBeVisible();

    // The recorded payload with the seeded token in place of the sanitized
    // one; polled because the intake may still be binding right after launch.
    const payload = JSON.parse(await readFile(MID_MATCH_PAYLOAD, 'utf8')) as {
      auth: { token: string };
    };
    payload.auth.token = FIXTURE_GSI_TOKEN;
    const body = JSON.stringify(payload);
    await expect.poll(() => postToIntake(port, body), { timeout: 10_000 }).toBe(200);

    await expect(gsiBadge).toContainText('Connected');
    const image = window.getByTestId('map-view-image');
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((element) => element.naturalWidth)).toBeGreaterThan(0);
    await expect(window.getByText('T Spawn', { exact: true })).toBeVisible();
  } finally {
    await close();
  }
});
