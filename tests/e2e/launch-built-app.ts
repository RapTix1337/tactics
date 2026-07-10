import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { _electron as electron } from '@playwright/test';

import { seedFixtureProfile, seedGsiSetup } from './seed-fixture-profile';

// Launched with the package root (not the bundle path): electron resolves
// the built bundle via package.json `main`, and app.getAppPath() points at
// the root — the same way production resolves bundled resources such as
// data/maps/ (app-lifecycle.ts).
const PACKAGE_ROOT = resolve(import.meta.dirname, '../..');
const MAIN_BUNDLE = join(PACKAGE_ROOT, 'out', 'main', 'index.js');

// Shared E2E launch helper (ADR-034 spike, E4.1; test mode formalized in
// E20.1): the built app in test mode — isolated user-data dir, update checks
// disabled, optionally a fixed GSI port, a pre-seeded fixture profile, and a
// pre-seeded GSI setup (E20.2).
export async function launchBuiltApp(
  options: {
    env?: Record<string, string>;
    seedFixtureProfile?: boolean;
    /**
     * Seeds a valid GSI setup for this port (`seedGsiSetup`) and pins the
     * intake to it via `TACTICS_GSI_PORT` — written config and server stay
     * in agreement, the app boots into `waiting`.
     */
    gsiSetupPort?: number;
    /**
     * Reuses an existing user-data directory instead of creating a fresh
     * one — the restart half of a persistence scenario. Seeding options are
     * for fresh directories; the caller keeps ownership of cleanup (the
     * returned `close` still removes the directory).
     */
    userDataDir?: string;
  } = {},
) {
  if (!existsSync(MAIN_BUNDLE)) {
    throw new Error(`Built main bundle missing at ${MAIN_BUNDLE} — run \`pnpm build\` first.`);
  }

  const userDataDir = options.userDataDir ?? (await mkdtemp(join(tmpdir(), 'tactics-e2e-')));
  if (options.seedFixtureProfile === true) {
    seedFixtureProfile(userDataDir);
  }
  if (options.gsiSetupPort !== undefined) {
    seedGsiSetup(userDataDir, options.gsiSetupPort);
  }
  const electronApp = await electron.launch({
    args: [PACKAGE_ROOT],
    env: {
      ...process.env,
      TACTICS_USER_DATA_DIR: userDataDir,
      TACTICS_DISABLE_UPDATES: '1',
      ...(options.gsiSetupPort !== undefined
        ? { TACTICS_GSI_PORT: String(options.gsiSetupPort) }
        : {}),
      ...options.env,
    },
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
