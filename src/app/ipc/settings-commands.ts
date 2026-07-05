import type { Settings } from '../../shared';
import { failure, settingsChanged, settingsUpdate, success } from '../../shared';
import type { EventPublisher } from './event-publisher';
import type { CommandRegistrationDeps } from './register-command';
import { describeError, registerCommand } from './register-command';

/**
 * Dependencies of the settings commands (E8.3) as narrow structural
 * interfaces (the E5.2/E6.3 pattern): the repository slice this file needs
 * and the central event publisher. The composition root passes the real
 * settings repository and the all-windows publisher.
 */
export interface SettingsCommandDeps {
  /** Merges, validates, and persists the partial; returns the full new state. */
  readonly updateSettings: (partial: Partial<Settings>) => Settings;
  readonly publisher: EventPublisher;
}

/**
 * Registers `settings.update` (03-technical-design.md §5.3/§5.4): the request
 * is fully validated at the IPC boundary by the shared field schemas, the
 * repository persists, and the full new slice is published as
 * `evt:settings.changed` — stores are fed by the event, the response exists
 * for the caller's error handling (ADR-033, no optimistic UI).
 */
export function registerSettingsCommands<TEvent>(
  deps: CommandRegistrationDeps<TEvent>,
  settings: SettingsCommandDeps,
): void {
  registerCommand(deps, settingsUpdate, (partial) => {
    let next: Settings;
    try {
      next = settings.updateSettings(partial);
    } catch (error) {
      if (error instanceof TypeError) {
        // A partial that passed the contract schema but fails the module's
        // validation is contract/module drift — a bug, so let it surface as
        // INTERNAL instead of mislabeling it a storage failure.
        throw error;
      }
      deps.logger.error('Persisting a settings update failed', { error: describeError(error) });
      return failure('DB_ERROR', 'The settings could not be saved.');
    }
    settings.publisher.publish(settingsChanged, next);
    return success(next);
  });
}
