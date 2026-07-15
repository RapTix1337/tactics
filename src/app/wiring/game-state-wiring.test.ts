import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createGsiIntakeServer,
  createGsiStatusMachine,
  type GsiIntakeServer,
  type GsiPayloadSubset,
  type GsiStatusMachine,
} from '../../modules/gsi';
import { createMapRegistry, type MapRegistry } from '../../modules/maps';
import type { OperationalState } from '../../modules/settings';
import { SETTINGS_DEFAULTS } from '../../modules/settings';
import type { GameState, Logger, Settings } from '../../shared';
import { createGameStateWiring, type GameStateWiring } from './game-state-wiring';

// The recorded corpus authenticates with this placeholder token
// (tests/fixtures/gsi/README.md) — the intake must be started with it.
const TOKEN = 'REDACTED';

const FIXTURES_DIR = fileURLToPath(new URL('../../../tests/fixtures/gsi/real', import.meta.url));

const silentLogger: Logger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

function fixture(relativePath: string): string {
  return readFileSync(join(FIXTURES_DIR, relativePath), 'utf8');
}

/** The mid-match corpus payload with its map name swapped for an unknown one. */
function unknownMapBody(): string {
  const payload = JSON.parse(fixture('03-mid-match/001.json')) as { map: { name: string } };
  payload.map.name = 'de_community_map';
  return JSON.stringify(payload);
}

function post(port: number, body: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const clientRequest = httpRequest(
      { host: '127.0.0.1', port, method: 'POST', path: '/' },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode ?? 0));
      },
    );
    clientRequest.on('error', reject);
    clientRequest.end(body);
  });
}

/** Reserves an OS-assigned free port (the http-intake.test.ts pattern). */
function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => (port > 0 && port < 65_500 ? resolve(port) : resolve(reservePort())));
    });
  });
}

const tempDirs: string[] = [];

/** A data directory containing exactly one valid map: de_dust2. */
function mapDataDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'tactics-game-state-'));
  tempDirs.push(directory);
  const folder = join(directory, 'de_dust2');
  mkdirSync(folder);
  writeFileSync(
    join(folder, 'map.json'),
    JSON.stringify({
      id: 'de_dust2',
      displayName: 'Dust 2',
      gsiNames: ['de_dust2'],
      callouts: [{ name: 'Mid', x: 0.5, y: 0.5 }],
    }),
    'utf8',
  );
  return directory;
}

interface Harness {
  wiring: GameStateWiring;
  machine: GsiStatusMachine;
  registry: MapRegistry;
  published: GameState[];
  settings: { current: Settings };
  operationalState: { current: OperationalState };
  persistEffectivePort: ReturnType<typeof vi.fn>;
  verifyConfigAgainstCurrent: ReturnType<typeof vi.fn>;
  errors: string[];
}

const wirings: GameStateWiring[] = [];

function createHarness(
  overrides: Partial<{
    gsiPort: number | null;
    effectiveGsiPort: number | null;
    gsiPortOverride: number;
    createIntake: (onPayload: (payload: GsiPayloadSubset) => void) => GsiIntakeServer;
  }> = {},
): Harness {
  const machine = createGsiStatusMachine({ schedule: () => () => undefined });
  const registry = createMapRegistry({ dataDirectory: mapDataDirectory(), logger: silentLogger });
  const published: GameState[] = [];
  const settings = { current: { ...SETTINGS_DEFAULTS, gsiPort: overrides.gsiPort ?? null } };
  const operationalState = {
    current: {
      gsiToken: TOKEN,
      effectiveGsiPort: overrides.effectiveGsiPort ?? null,
      windowBounds: null,
      overlayBounds: null,
    },
  };
  const persistEffectivePort = vi.fn((port: number) => {
    operationalState.current = { ...operationalState.current, effectiveGsiPort: port };
  });
  const verifyConfigAgainstCurrent = vi.fn(() => Promise.resolve());
  const errors: string[] = [];
  const wiring = createGameStateWiring({
    statusMachine: machine,
    createIntake:
      overrides.createIntake ??
      ((onPayload) => createGsiIntakeServer({ logger: silentLogger, onPayload })),
    resolveGsiMapName: (rawName) => registry.resolveGsiMapName(rawName),
    publish: (state) => published.push(state),
    getSettings: () => settings.current,
    getOperationalState: () => operationalState.current,
    gsiPortOverride: overrides.gsiPortOverride,
    persistEffectivePort,
    verifyConfigAgainstCurrent,
    logger: {
      ...silentLogger,
      error: (message) => {
        errors.push(message);
      },
    },
  });
  wirings.push(wiring);
  return {
    wiring,
    machine,
    registry,
    published,
    settings,
    operationalState,
    persistEffectivePort,
    verifyConfigAgainstCurrent,
    errors,
  };
}

afterEach(async () => {
  for (const wiring of wirings.splice(0)) {
    await wiring.stop();
  }
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** Boots the full pipeline on a reserved port: maps loaded, intake bound. */
async function startedHarness(): Promise<Harness & { port: number }> {
  const port = await reservePort();
  const harness = createHarness({ gsiPort: port });
  await harness.registry.loadAll();
  await harness.wiring.start();
  const bound = harness.operationalState.current.effectiveGsiPort;
  if (bound === null) {
    throw new Error('intake did not bind during test setup');
  }
  return { ...harness, port: bound };
}

describe('createGameStateWiring', () => {
  it('publishes connected with the resolved map for a real corpus payload (end to end)', async () => {
    const harness = await startedHarness();
    harness.machine.reportConfigValid(); // → waiting

    expect(await post(harness.port, fixture('03-mid-match/001.json'))).toBe(200);

    expect(harness.published).toEqual([
      { status: 'waiting', map: { kind: 'none' } },
      { status: 'connected', map: { kind: 'resolved', mapId: 'de_dust2' } },
    ]);
  });

  it('publishes the informative unsupported state with the raw name for an unknown map', async () => {
    const harness = await startedHarness();
    harness.machine.reportConfigValid();

    expect(await post(harness.port, unknownMapBody())).toBe(200);

    expect(harness.published.at(-1)).toEqual({
      status: 'connected',
      map: { kind: 'unsupported', rawName: 'de_community_map' },
    });
  });

  it('clears the map when a menus payload arrives (map section gone)', async () => {
    const harness = await startedHarness();
    harness.machine.reportConfigValid();
    await post(harness.port, fixture('03-mid-match/001.json'));

    await post(harness.port, fixture('01-menus/001.json'));

    expect(harness.published.at(-1)).toEqual({ status: 'connected', map: { kind: 'none' } });
  });

  it('derives the snapshot slice from the machine state on demand', async () => {
    const harness = await startedHarness();
    expect(harness.wiring.getGameState()).toEqual({ status: 'not-set-up', map: { kind: 'none' } });

    harness.machine.reportConfigValid();
    await post(harness.port, fixture('03-mid-match/001.json'));

    expect(harness.wiring.getGameState()).toEqual({
      status: 'connected',
      map: { kind: 'resolved', mapId: 'de_dust2' },
    });
  });

  it('persists the effective port and triggers a config re-verify when it changes', async () => {
    const harness = await startedHarness();

    expect(harness.persistEffectivePort).toHaveBeenCalledWith(harness.port);
    expect(harness.verifyConfigAgainstCurrent).toHaveBeenCalledTimes(1);
  });

  it('rebinds onto a changed gsiPort setting and keeps receiving payloads', async () => {
    const harness = await startedHarness();
    harness.machine.reportConfigValid();
    const newPort = await reservePort();

    harness.settings.current = { ...harness.settings.current, gsiPort: newPort };
    await harness.wiring.handleSettingsChanged();

    expect(harness.operationalState.current.effectiveGsiPort).toBe(newPort);
    // The old port is released, the new one serves the pipeline.
    await expect(post(harness.port, fixture('03-mid-match/001.json'))).rejects.toThrow();
    expect(await post(newPort, fixture('03-mid-match/001.json'))).toBe(200);
    expect(harness.published.at(-1)).toEqual({
      status: 'connected',
      map: { kind: 'resolved', mapId: 'de_dust2' },
    });
  });

  it('does not restart when a settings change leaves the desired port untouched', async () => {
    const harness = await startedHarness();

    harness.settings.current = { ...harness.settings.current, theme: 'light' };
    await harness.wiring.handleSettingsChanged();

    expect(harness.persistEffectivePort).toHaveBeenCalledTimes(1);
    expect(await post(harness.port, fixture('01-menus/001.json'))).toBe(200);
  });

  it('re-verifies the config on a gsiTiming change without rebinding (SCB.4)', async () => {
    const harness = await startedHarness();
    // The initial bind already re-verified once; the timing change adds one.
    harness.verifyConfigAgainstCurrent.mockClear();

    harness.settings.current = { ...harness.settings.current, gsiTiming: 'fast' };
    await harness.wiring.handleSettingsChanged();

    expect(harness.verifyConfigAgainstCurrent).toHaveBeenCalledTimes(1);
    // No rebind: the intake keeps serving the same port (timing is config-only).
    expect(harness.persistEffectivePort).toHaveBeenCalledTimes(1);
    expect(await post(harness.port, fixture('03-mid-match/001.json'))).toBe(200);
  });

  it('does not re-verify when a settings change leaves gsiTiming untouched', async () => {
    const harness = await startedHarness();
    harness.verifyConfigAgainstCurrent.mockClear();

    harness.settings.current = { ...harness.settings.current, theme: 'light' };
    await harness.wiring.handleSettingsChanged();

    expect(harness.verifyConfigAgainstCurrent).not.toHaveBeenCalled();
  });

  it('starts on the test-mode port override even when settings fix another port (E20.1)', async () => {
    const started: number[] = [];
    const fakeIntake: GsiIntakeServer = {
      start: (port) => {
        started.push(port);
        return Promise.resolve({ ok: true, port } as const);
      },
      stop: () => Promise.resolve(),
    };
    const harness = createHarness({
      gsiPort: 42_730,
      effectiveGsiPort: 42_731,
      gsiPortOverride: 45_123,
      createIntake: () => fakeIntake,
    });

    await harness.wiring.start();

    expect(started).toEqual([45_123]);
    // A settings port change cannot move the intake off the override.
    harness.settings.current = { ...harness.settings.current, gsiPort: 43_000 };
    await harness.wiring.handleSettingsChanged();
    expect(started).toEqual([45_123]);
  });

  it('logs chain exhaustion and recovers via a later port settings change', async () => {
    let failNext = true;
    const started: number[] = [];
    const fakeIntake: GsiIntakeServer = {
      start: (port) => {
        if (failNext) {
          failNext = false;
          return Promise.resolve({ ok: false, error: { code: 'PORT_UNAVAILABLE' } } as const);
        }
        started.push(port);
        return Promise.resolve({ ok: true, port } as const);
      },
      stop: () => Promise.resolve(),
    };
    const harness = createHarness({ gsiPort: 42_730, createIntake: () => fakeIntake });

    await harness.wiring.start();
    expect(harness.errors).toContain('GSI intake could not bind any port of the fallback chain');
    expect(harness.persistEffectivePort).not.toHaveBeenCalled();

    // Error case 3: "manually fixable in settings" — the next port change starts.
    harness.settings.current = { ...harness.settings.current, gsiPort: 43_000 };
    await harness.wiring.handleSettingsChanged();
    expect(started).toEqual([43_000]);
    expect(harness.operationalState.current.effectiveGsiPort).toBe(43_000);
  });

  it('survives a failing effective-port persistence and logs it', async () => {
    const port = await reservePort();
    const harness = createHarness({ gsiPort: port });
    harness.persistEffectivePort.mockImplementation(() => {
      throw new Error('database is locked');
    });
    await harness.registry.loadAll();

    await harness.wiring.start();
    harness.machine.reportConfigValid();

    expect(harness.errors).toContain('Persisting the effective GSI port failed');
    expect(harness.verifyConfigAgainstCurrent).not.toHaveBeenCalled();
    // The pipeline still works — persistence is a best-effort sync.
    expect(await post(port, fixture('01-menus/001.json'))).toBe(200);
  });

  it('stops publishing after stop and releases the port', async () => {
    const harness = await startedHarness();
    harness.machine.reportConfigValid();
    const publishedBefore = harness.published.length;

    await harness.wiring.stop();

    harness.machine.reportConfigInvalid();
    expect(harness.published.length).toBe(publishedBefore);
    await expect(post(harness.port, fixture('01-menus/001.json'))).rejects.toThrow();
  });
});
