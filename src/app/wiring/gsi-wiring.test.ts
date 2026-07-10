import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_GSI_PORT, GSI_CONFIG_FILE_NAME } from '../../modules/gsi';
import type { OperationalState } from '../../modules/settings';
import { SETTINGS_DEFAULTS } from '../../modules/settings';
import type { RegistryReader } from '../../modules/steam';
import type { Logger, Settings } from '../../shared';
import { createGsiWiring, type GsiWiringOptions } from './gsi-wiring';

const TOKEN = '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0';
const INSTALL_DIR = 'Counter-Strike Global Offensive';

const silentLogger: Logger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

const noRegistry: RegistryReader = { readValue: () => Promise.resolve(undefined) };

function createOperationalState(overrides: Partial<OperationalState> = {}): OperationalState {
  return { gsiToken: TOKEN, effectiveGsiPort: null, windowBounds: null, ...overrides };
}

function createWiring(
  overrides: Partial<GsiWiringOptions> = {},
): ReturnType<typeof createGsiWiring> {
  return createGsiWiring({
    getSettings: () => SETTINGS_DEFAULTS,
    getOperationalState: () => createOperationalState(),
    registry: noRegistry,
    steamLogger: silentLogger,
    configLocationRecorder: { record: () => Promise.resolve(true) },
    ...overrides,
  });
}

describe('createGsiWiring', () => {
  describe('resolveSetupTarget', () => {
    it('prefers the manual cs2Path setting and never touches the registry', async () => {
      const readValue = vi.fn(() => Promise.resolve(undefined));
      const settings: Settings = { ...SETTINGS_DEFAULTS, cs2Path: 'D:\\Games\\CS2' };
      const { commandDeps } = createWiring({
        getSettings: () => settings,
        registry: { readValue },
      });

      await expect(commandDeps.resolveSetupTarget()).resolves.toEqual({
        source: 'manual',
        gameRoot: 'D:\\Games\\CS2',
        cfgDir: 'D:\\Games\\CS2\\game\\csgo\\cfg',
      });
      expect(readValue).not.toHaveBeenCalled();
    });

    it('resolves undefined when the detection chain finds nothing', async () => {
      const { commandDeps } = createWiring();

      await expect(commandDeps.resolveSetupTarget()).resolves.toBeUndefined();
    });

    it('maps a detection hit to a detected target with its cfg dir', async () => {
      // A minimal real Steam tree (the locate-cs2 test fixtures, condensed).
      const root = mkdtempSync(join(tmpdir(), 'tactics-gsi-wiring-'));
      try {
        const steamDir = join(root, 'steam');
        mkdirSync(join(steamDir, 'steamapps'), { recursive: true });
        writeFileSync(
          join(steamDir, 'steamapps', 'libraryfolders.vdf'),
          `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steamDir.replaceAll('\\', '\\\\')}"\n\t}\n}\n`,
          'utf8',
        );
        writeFileSync(
          join(steamDir, 'steamapps', 'appmanifest_730.acf'),
          `"AppState"\n{\n\t"appid"\t\t"730"\n\t"installdir"\t\t"${INSTALL_DIR}"\n}\n`,
          'utf8',
        );
        const { commandDeps } = createWiring({
          registry: { readValue: () => Promise.resolve(steamDir) },
        });

        const gameRoot = join(steamDir, 'steamapps', 'common', INSTALL_DIR);
        await expect(commandDeps.resolveSetupTarget()).resolves.toEqual({
          source: 'detected',
          gameRoot,
          cfgDir: join(gameRoot, 'game', 'csgo', 'cfg'),
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('getSetupPort', () => {
    it('lets the test-mode override win over settings and effective port (E20.1)', () => {
      const { commandDeps } = createWiring({
        getSettings: () => ({ ...SETTINGS_DEFAULTS, gsiPort: 51000 }),
        getOperationalState: () => createOperationalState({ effectiveGsiPort: 42731 }),
        gsiPortOverride: 45123,
      });

      expect(commandDeps.getSetupPort()).toBe(45123);
    });

    it('lets a fixed gsiPort setting win', () => {
      const { commandDeps } = createWiring({
        getSettings: () => ({ ...SETTINGS_DEFAULTS, gsiPort: 51000 }),
        getOperationalState: () => createOperationalState({ effectiveGsiPort: 42731 }),
      });

      expect(commandDeps.getSetupPort()).toBe(51000);
    });

    it('falls back to the last effective port in automatic mode', () => {
      const { commandDeps } = createWiring({
        getOperationalState: () => createOperationalState({ effectiveGsiPort: 42733 }),
      });

      expect(commandDeps.getSetupPort()).toBe(42733);
    });

    it('uses the ADR-031 default before any first server start', () => {
      const { commandDeps } = createWiring();

      expect(commandDeps.getSetupPort()).toBe(DEFAULT_GSI_PORT);
    });
  });

  it('hands out the operational-state token and the config path', () => {
    const { commandDeps } = createWiring();

    expect(commandDeps.getAuthToken()).toBe(TOKEN);
    expect(commandDeps.getConfigPath('C:\\cs2\\cfg')).toBe(
      join('C:\\cs2\\cfg', GSI_CONFIG_FILE_NAME),
    );
  });

  it('delegates the uninstall-hygiene record to the injected recorder (E19.2)', async () => {
    const record = vi.fn(() => Promise.resolve(true));
    const { commandDeps } = createWiring({ configLocationRecorder: { record } });

    await expect(commandDeps.recordConfigLocation('C:\\cs2\\cfg\\x.cfg')).resolves.toBe(true);

    expect(record).toHaveBeenCalledExactlyOnceWith('C:\\cs2\\cfg\\x.cfg');
  });

  it('wires the config reports to the shared status machine instance', () => {
    const { commandDeps, statusMachine } = createWiring();

    commandDeps.reportConfigInvalid();
    expect(statusMachine.getState().status).toBe('repair-needed');

    commandDeps.reportConfigValid();
    expect(statusMachine.getState().status).toBe('waiting');

    statusMachine.dispose();
  });
});
