import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  generateConfigContent,
  GSI_CONFIG_FILE_NAME,
} from '../../src/modules/gsi/core/config-content';
import { deriveCfgDir } from '../../src/modules/steam/core/cs2-paths';

// Pre-seeds an isolated user-data directory before the app launches: a
// fixture map profile (image + callouts) so browse-mode E2E scenarios have
// data without driving the upload dialog (ADR-045, E20.1), and optionally a
// complete GSI setup (manual CS2 path + config file + fixed token) so the
// live scenario boots into `waiting` deterministically on every machine
// (E20.2 — the manual `cs2Path` setting wins over registry detection).
//
// Why not the app's own storage stack: during `pnpm test:e2e` better-sqlite3
// carries the Electron ABI (ADR-041) and cannot load in the Playwright
// process — `node:sqlite` writes the same file without any native module.
// The cost is deliberate, narrow schema coupling: this helper mirrors the
// migration runner's tracking table (migration-runner.ts), the three ADR-045
// profile tables (0002_map-profiles.sql), and the settings/operational-state
// rows (0000/0001). Drift fails the E2E suite loudly at app startup — it
// cannot go unnoticed. The GSI config content itself comes from the real
// generator (pure core, ADR-019), so a format change can never drift here.

const PACKAGE_ROOT = resolve(import.meta.dirname, '../..');
const MIGRATIONS_DIR = join(PACKAGE_ROOT, 'src', 'modules', 'storage', 'migrations');
const FIXTURE_IMAGE = join(PACKAGE_ROOT, 'tests', 'fixtures', 'maps', 'de_dust2', 'main.svg');
const DEFAULT_LAYOUT_FILE = join(PACKAGE_ROOT, 'data', 'maps', 'de_dust2', 'map.json');

const FIXTURE_MAP_ID = 'de_dust2';
const FIXTURE_PROFILE_ID = 'e2e-fixture-profile';
const FIXTURE_PROFILE_NAME = 'E2E Fixture';

/**
 * The seeded GSI auth token (64 lowercase hex chars, the operational-state
 * shape): `seedGsiSetup` writes it into the database and the config file;
 * the live-view scenario posts payloads carrying it.
 */
export const FIXTURE_GSI_TOKEN = 'e2e0'.repeat(16);
// Fixed and arbitrary — profile ordering only needs a deterministic value.
const FIXTURE_CREATED_AT = 1_700_000_000_000;

/**
 * Callouts of the bundled Dust 2 default layout — the same set a real upload
 * would seed (maps-commands.ts hands `map.callouts` to `createProfile`).
 */
function defaultLayoutCallouts(): { name: string; x: number; y: number }[] {
  const parsed: unknown = JSON.parse(readFileSync(DEFAULT_LAYOUT_FILE, 'utf8'));
  const callouts =
    typeof parsed === 'object' && parsed !== null && 'callouts' in parsed
      ? parsed.callouts
      : undefined;
  if (!Array.isArray(callouts) || callouts.length === 0) {
    throw new Error(`bundled default layout has no callouts: ${DEFAULT_LAYOUT_FILE}`);
  }
  return callouts.map((callout: unknown) => {
    if (
      typeof callout !== 'object' ||
      callout === null ||
      !('name' in callout) ||
      !('x' in callout) ||
      !('y' in callout) ||
      typeof callout.name !== 'string' ||
      typeof callout.x !== 'number' ||
      typeof callout.y !== 'number'
    ) {
      throw new Error(`bundled default layout has a malformed callout: ${DEFAULT_LAYOUT_FILE}`);
    }
    return { name: callout.name, x: callout.x, y: callout.y };
  });
}

/**
 * Opens `tactics.db` fully migrated (each migration recorded exactly like
 * the app's runner, so startup sees an up-to-date database) and returns the
 * open handle for the seed inserts. A database an earlier seed step already
 * migrated is reused as-is — the seed functions are composable per launch.
 */
function openMigratedDatabase(userDataDir: string): DatabaseSync {
  const db = new DatabaseSync(join(userDataDir, 'tactics.db'));
  const alreadyMigrated =
    db
      .prepare("select name from sqlite_master where type = 'table' and name = 'schema_migrations'")
      .get() !== undefined;
  if (alreadyMigrated) {
    return db;
  }
  db.exec(`create table if not exists schema_migrations (
    id integer primary key,
    name text not null,
    applied_at text not null
  )`);
  const insertTrackingRow = db.prepare(
    'insert into schema_migrations (id, name, applied_at) values (?, ?, ?)',
  );
  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();
  for (const fileName of migrationFiles) {
    const id = Number.parseInt(fileName, 10);
    if (Number.isNaN(id)) {
      throw new Error(`migration file name has no numeric prefix: ${fileName}`);
    }
    db.exec(readFileSync(join(MIGRATIONS_DIR, fileName), 'utf8'));
    insertTrackingRow.run(id, fileName.replace(/\.sql$/, ''), new Date().toISOString());
  }
  return db;
}

/**
 * Seeds one Dust 2 profile (default-layout callouts + the fixture SVG as its
 * image) into a user-data directory the app has not opened yet. Call before
 * `launchBuiltApp` hands the directory to the app.
 */
export function seedFixtureProfile(userDataDir: string): void {
  const imageFileName = `${FIXTURE_PROFILE_ID}.svg`;

  const db = openMigratedDatabase(userDataDir);
  try {
    db.prepare(
      'insert into map_profiles (id, map_id, name, image_file_name, created_at) values (?, ?, ?, ?, ?)',
    ).run(
      FIXTURE_PROFILE_ID,
      FIXTURE_MAP_ID,
      FIXTURE_PROFILE_NAME,
      imageFileName,
      FIXTURE_CREATED_AT,
    );
    const insertCallout = db.prepare(
      'insert into profile_callouts (profile_id, name, x, y) values (?, ?, ?, ?)',
    );
    for (const callout of defaultLayoutCallouts()) {
      insertCallout.run(FIXTURE_PROFILE_ID, callout.name, callout.x, callout.y);
    }
    db.prepare('insert into map_default_profiles (map_id, profile_id) values (?, ?)').run(
      FIXTURE_MAP_ID,
      FIXTURE_PROFILE_ID,
    );
  } finally {
    db.close();
  }

  // The image exactly where the store resolves it: <userData>/maps/<mapId>/.
  const imageDir = join(userDataDir, 'maps', FIXTURE_MAP_ID);
  mkdirSync(imageDir, { recursive: true });
  copyFileSync(FIXTURE_IMAGE, join(imageDir, imageFileName));
}

/**
 * Seeds a valid GSI setup for the given intake port: a fixture CS2 tree
 * inside the user-data directory whose `cs2Path` setting the startup verify
 * resolves as the manual pick (no registry detection, so no machine
 * dependence), a config file the byte comparison accepts, and the fixed
 * token in operational state — the app boots into `waiting`, and a posted
 * payload carrying `FIXTURE_GSI_TOKEN` drives it to `connected` (E20.2
 * scenario 5). The settings row mirrors the binding defaults
 * (03-technical-design.md §7.3) apart from `cs2Path`.
 */
export function seedGsiSetup(userDataDir: string, port: number): void {
  const gameRoot = join(userDataDir, 'cs2');
  const cfgDir = deriveCfgDir(gameRoot);
  mkdirSync(cfgDir, { recursive: true });
  writeFileSync(
    join(cfgDir, GSI_CONFIG_FILE_NAME),
    generateConfigContent(port, FIXTURE_GSI_TOKEN),
    'utf8',
  );

  const db = openMigratedDatabase(userDataDir);
  try {
    db.prepare(
      `insert into settings (id, theme, cs2_path, gsi_port, autostart, close_to_tray, auto_update)
       values (1, 'dark', ?, null, 0, 1, 1)`,
    ).run(gameRoot);
    db.prepare(
      'insert into operational_state (id, gsi_token, effective_gsi_port) values (1, ?, null)',
    ).run(FIXTURE_GSI_TOKEN);
  } finally {
    db.close();
  }
}
