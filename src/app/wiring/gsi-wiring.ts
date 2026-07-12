import { join } from 'node:path';

import {
  createGsiStatusMachine,
  DEFAULT_GSI_PORT,
  GSI_CONFIG_FILE_NAME,
  type GsiConfigLocationRecorder,
  type GsiStatusMachine,
  verifyConfig,
  writeConfig,
} from '../../modules/gsi';
import type { OperationalState } from '../../modules/settings';
import { deriveCfgDir, locateCs2Installation, type RegistryReader } from '../../modules/steam';
import type { Logger, Settings } from '../../shared';
import type { GsiCommandDeps, GsiSetupTarget } from '../ipc/gsi-commands';

/**
 * Composition of the gsi module for E10.6 (03-technical-design.md §2.1:
 * wiring only, no business logic): the status machine instance the whole
 * main process shares (E10.7 later connects the intake and the gameState
 * event to the same instance) plus the module-backed `GsiCommandDeps`.
 */
export interface GsiWiring {
  readonly statusMachine: GsiStatusMachine;
  readonly commandDeps: GsiCommandDeps;
}

export interface GsiWiringOptions {
  readonly getSettings: () => Settings;
  readonly getOperationalState: () => OperationalState;
  /** The detection chain's registry access (`createRegExeReader()` in prod). */
  readonly registry: RegistryReader;
  /** Detection-chain logger (the `steam` scope — the chain lives there). */
  readonly steamLogger: Logger;
  /**
   * Uninstall-hygiene record of the written config path (E19.2, ADR-048;
   * `createRegExeConfigLocationRecorder()` in prod).
   */
  readonly configLocationRecorder: GsiConfigLocationRecorder;
  /**
   * Test-mode port override (`TACTICS_GSI_PORT`, E20.1): wins over settings
   * and operational state. Must match the override handed to
   * `createGameStateWiring` — server and written config stay in agreement.
   */
  readonly gsiPortOverride?: number;
}

export function createGsiWiring(options: GsiWiringOptions): GsiWiring {
  // Real timers for the ADR-031 stale timeout — the core takes them as a
  // port (ADR-019); unref'd so a pending timeout never holds the app open.
  const statusMachine = createGsiStatusMachine({
    schedule: (callback, delayMs): (() => void) => {
      const handle = setTimeout(callback, delayMs).unref();
      return (): void => {
        clearTimeout(handle);
      };
    },
  });
  return {
    statusMachine,
    commandDeps: {
      resolveSetupTarget: async (): Promise<GsiSetupTarget | undefined> => {
        // The manual pick wins (GSI-02): it exists because detection failed
        // or the user overrode it — and it was structure-validated on pick.
        const manualPath = options.getSettings().cs2Path;
        if (manualPath !== null) {
          return { source: 'manual', gameRoot: manualPath, cfgDir: deriveCfgDir(manualPath) };
        }
        const located = await locateCs2Installation(options.registry, options.steamLogger);
        if (!located.ok) {
          return undefined;
        }
        return {
          source: 'detected',
          gameRoot: located.paths.gameRoot,
          cfgDir: located.paths.cfgDir,
        };
      },
      // The port the config must announce: a fixed setting wins; otherwise
      // the port the server last actually bound; before any first start the
      // ADR-031 default. E10.7 keeps the effective port in sync.
      getSetupPort: (): number =>
        options.gsiPortOverride ??
        options.getSettings().gsiPort ??
        options.getOperationalState().effectiveGsiPort ??
        DEFAULT_GSI_PORT,
      // The config content's timing profile (ADR-051) — a plain settings read;
      // a change rides the same repair-needed path as a port/token change.
      getSetupTiming: () => options.getSettings().gsiTiming,
      getAuthToken: (): string => options.getOperationalState().gsiToken,
      getConfigPath: (cfgDir: string): string => join(cfgDir, GSI_CONFIG_FILE_NAME),
      verifyConfig,
      writeConfig,
      recordConfigLocation: (configPath: string): Promise<boolean> =>
        options.configLocationRecorder.record(configPath),
      reportConfigValid: (): void => {
        statusMachine.reportConfigValid();
      },
      reportConfigInvalid: (): void => {
        statusMachine.reportConfigInvalid();
      },
    },
  };
}
