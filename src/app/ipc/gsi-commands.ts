import type { Logger } from '../../shared';
import { failure, gsiApplySetup, gsiGetSetupPlan, success } from '../../shared';
import type { CommandRegistrationDeps } from './register-command';
import { describeError, registerCommand } from './register-command';

/** The gsi module's verify result, as narrow as this file needs it. */
export type GsiConfigCheck = 'ok' | 'missing' | 'outdated';

/**
 * Where the setup would write, resolved by the composition root from the
 * `cs2Path` setting (manual) or the `steam` detection chain (detected).
 */
export interface GsiSetupTarget {
  readonly source: 'detected' | 'manual';
  readonly gameRoot: string;
  readonly cfgDir: string;
}

/**
 * Dependencies of the gsi commands (E10.6) as narrow structural interfaces
 * (the E9.3 pattern): path resolution, port/token lookup, and the config
 * file adapter are injected so the flows are testable with temp trees and
 * faked modules. The status machine's config inputs close the §6.1 loop.
 */
export interface GsiCommandDeps {
  /** Manual `cs2Path` setting first, else detection; `undefined` = not found. */
  readonly resolveSetupTarget: () => Promise<GsiSetupTarget | undefined>;
  /** `settings.gsiPort` ?? last effective port ?? the ADR-031 default. */
  readonly getSetupPort: () => number;
  /** GSI auth token from operational state (generated on first access). */
  readonly getAuthToken: () => string;
  /** Absolute path of the config file inside a cfg directory (plan display and uninstall record). */
  readonly getConfigPath: (cfgDir: string) => string;
  readonly verifyConfig: (cfgDir: string, port: number, token: string) => Promise<GsiConfigCheck>;
  readonly writeConfig: (cfgDir: string, port: number, token: string) => Promise<void>;
  /**
   * Records the written config's absolute path for the NSIS uninstaller
   * (E19.2, ADR-048). Best-effort by contract: `false` = not recorded;
   * a failure must never fail the setup itself.
   */
  readonly recordConfigLocation: (configPath: string) => Promise<boolean>;
  /** The status machine's config-verification inputs (05-gsi.md §6.1). */
  readonly reportConfigValid: () => void;
  readonly reportConfigInvalid: () => void;
}

/**
 * Registers `gsi.getSetupPlan` and `gsi.applySetup` (03-technical-design.md
 * §5.3, MVP-02, GSI-03/04/06). The plan is a preview only — it changes
 * nothing; apply is the contract's single config write path, called
 * exclusively from the confirmation dialog (structural consent, ADR-032),
 * and serves setup and repair identically. Per ADR-042 the dialog shows a
 * static restart note, so no "CS2 is running" probe exists here.
 */
export function registerGsiCommands<TEvent>(
  deps: CommandRegistrationDeps<TEvent>,
  gsi: GsiCommandDeps,
): void {
  registerCommand(deps, gsiGetSetupPlan, async () => {
    const target = await gsi.resolveSetupTarget();
    if (target === undefined) {
      return success({ status: 'cs2-not-found' } as const);
    }
    return success({
      status: 'ready',
      source: target.source,
      gameRoot: target.gameRoot,
      configPath: gsi.getConfigPath(target.cfgDir),
      port: gsi.getSetupPort(),
    } as const);
  });

  registerCommand(deps, gsiApplySetup, async () => {
    const target = await gsi.resolveSetupTarget();
    if (target === undefined) {
      return failure(
        'CS2_NOT_FOUND',
        'No CS2 installation found. Select the CS2 folder first, then retry.',
      );
    }

    const port = gsi.getSetupPort();
    const token = gsi.getAuthToken();
    let check: GsiConfigCheck;
    try {
      await gsi.writeConfig(target.cfgDir, port, token);
      // Re-verify the bytes CS2 will actually read (E10.6 acceptance) —
      // also the transition input: a written config is a verified config.
      check = await gsi.verifyConfig(target.cfgDir, port, token);
    } catch (error) {
      // Paths and error names only — never token or content (ADR-030).
      deps.logger.error('Writing the GSI config failed', {
        cfgDir: target.cfgDir,
        error: describeError(error),
      });
      return failure(
        'CFG_DIR_NOT_WRITABLE',
        'The GSI config could not be written to the CS2 cfg folder.',
      );
    }

    if (check !== 'ok') {
      // A just-written config that reads back different means the write is
      // not sticking (filter driver, sync issue) — surface it, never fake ok.
      deps.logger.error('GSI config re-verification failed after write', {
        cfgDir: target.cfgDir,
        result: check,
      });
      gsi.reportConfigInvalid();
      return failure(
        'CFG_DIR_NOT_WRITABLE',
        'The GSI config was written but could not be verified afterwards.',
      );
    }

    gsi.reportConfigValid();
    // Uninstall hygiene (ADR-048): remember where the file lives so the
    // uninstaller can remove it. Strictly best-effort — the setup already
    // succeeded, so a recording failure is logged, never surfaced.
    try {
      const recorded = await gsi.recordConfigLocation(gsi.getConfigPath(target.cfgDir));
      if (!recorded) {
        deps.logger.warn('Recording the GSI config location for uninstall failed', {
          cfgDir: target.cfgDir,
        });
      }
    } catch (error) {
      deps.logger.warn('Recording the GSI config location for uninstall threw', {
        cfgDir: target.cfgDir,
        error: describeError(error),
      });
    }
    return success(undefined);
  });
}

/**
 * The E10.6 startup verification: check the installed config against the
 * currently expected content and feed the result into the state machine —
 * a healthy install boots into `waiting`, a deleted or stale config into
 * `repair-needed` (05-gsi.md §6.1). No CS2 found leaves `not-set-up`
 * untouched. Never throws: startup must not die on a cfg-dir hiccup — an
 * unreadable config is treated as invalid (the repair flow handles it).
 */
export async function runStartupConfigVerify(gsi: GsiCommandDeps, logger: Logger): Promise<void> {
  let target: GsiSetupTarget | undefined;
  try {
    target = await gsi.resolveSetupTarget();
  } catch (error) {
    logger.error('CS2 resolution during startup verify failed', {
      error: describeError(error),
    });
    return;
  }
  if (target === undefined) {
    logger.info('GSI startup verify skipped — no CS2 installation known');
    return;
  }

  let check: GsiConfigCheck;
  try {
    check = await gsi.verifyConfig(target.cfgDir, gsi.getSetupPort(), gsi.getAuthToken());
  } catch (error) {
    logger.warn('GSI config unreadable during startup verify — treating as invalid', {
      cfgDir: target.cfgDir,
      error: describeError(error),
    });
    check = 'outdated';
  }

  logger.info('GSI config verified at startup', { source: target.source, result: check });
  if (check === 'ok') {
    gsi.reportConfigValid();
  } else {
    gsi.reportConfigInvalid();
  }
}
