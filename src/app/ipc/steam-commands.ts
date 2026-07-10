import type { Settings } from '../../shared';
import { failure, settingsChanged, steamPickCs2Path, success } from '../../shared';
import type { EventPublisher } from './event-publisher';
import type { CommandRegistrationDeps } from './register-command';
import { describeError, registerCommand } from './register-command';

/** The steam module's validation result, as narrow as this file needs it. */
export type Cs2PathValidation =
  | { readonly ok: true; readonly paths: { readonly gameRoot: string } }
  | { readonly ok: false; readonly reason: string };

/**
 * Dependencies of the steam commands (E9.3) as narrow structural interfaces
 * (the E5.2/E6.3 pattern): native dialog and validation are injected so the
 * flow is testable without Electron or a real CS2 installation.
 */
export interface SteamCommandDeps {
  /** Native directory dialog: resolves to the picked path, or undefined on cancel. */
  readonly showDirectoryDialog: () => Promise<string | undefined>;
  /** ADR-025 §4: structure check before the path could ever be written to. */
  readonly validateCs2Path: (path: string) => Promise<Cs2PathValidation>;
  /** Merges, validates, and persists the partial; returns the full new state. */
  readonly updateSettings: (partial: Partial<Settings>) => Settings;
  readonly publisher: EventPublisher;
}

/**
 * Registers `steam.pickCs2Path` (03-technical-design.md §5.3, GSI-02): the
 * manual fallback when detection fails. Dialog → validation → persist as the
 * `cs2Path` setting → `evt:settings.changed` with the full new slice. An
 * invalid pick is the named `INVALID_PATH` error and persists nothing;
 * cancel is a regular outcome (the `logs.export` precedent).
 */
export function registerSteamCommands<TEvent>(
  deps: CommandRegistrationDeps<TEvent>,
  steam: SteamCommandDeps,
): void {
  registerCommand(deps, steamPickCs2Path, async () => {
    const pickedPath = await steam.showDirectoryDialog();
    if (pickedPath === undefined) {
      return success({ status: 'canceled' } as const);
    }

    const validation = await steam.validateCs2Path(pickedPath);
    if (!validation.ok) {
      // Paths and fixed reasons only — never tokens or SteamIDs (ADR-030).
      deps.logger.debug('Picked CS2 path failed validation', {
        pickedPath,
        reason: validation.reason,
      });
      return failure(
        'INVALID_PATH',
        'The selected folder is not a CS2 installation (expected game/csgo/cfg inside).',
      );
    }

    let settings: Settings;
    try {
      settings = steam.updateSettings({ cs2Path: validation.paths.gameRoot });
    } catch (error) {
      if (error instanceof TypeError) {
        // A validated non-empty path rejected by the settings module is
        // contract/module drift — a bug, so let it surface as INTERNAL
        // instead of mislabeling it a storage failure (the E8.3 pattern).
        throw error;
      }
      deps.logger.error('Persisting the picked CS2 path failed', {
        error: describeError(error),
      });
      return failure('DB_ERROR', 'The selected path could not be saved.');
    }

    steam.publisher.publish(settingsChanged, settings);
    return success({ status: 'selected', settings } as const);
  });
}
