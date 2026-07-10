import { failure, success, updatesCheck, updatesInstall } from '../../shared';
import type { CommandRegistrationDeps } from './register-command';
import { registerCommand } from './register-command';

/**
 * Dependencies of the updates commands (E18.1) as narrow structural
 * interfaces (the E5.2 pattern): the two service entry points the commands
 * need. The composition root passes the update service.
 */
export interface UpdatesCommandDeps {
  /** Manual check; the module refuses it while auto-update is disabled (PRV-02). */
  readonly checkNow: () => void;
  /** Installs the downloaded update; `false` when none is ready. */
  readonly quitAndInstall: () => boolean;
}

/**
 * Registers `updates.check` and `updates.install` (03-technical-design.md
 * §5.3, REL-02). The check only acknowledges — results arrive as
 * `evt:update.changed`, stores are fed by the event (ADR-033); install
 * without a downloaded update is the named `UPDATE_NOT_READY` error.
 */
export function registerUpdatesCommands<TEvent>(
  deps: CommandRegistrationDeps<TEvent>,
  updates: UpdatesCommandDeps,
): void {
  registerCommand(deps, updatesCheck, () => {
    updates.checkNow();
    return success(undefined);
  });

  registerCommand(deps, updatesInstall, () => {
    if (!updates.quitAndInstall()) {
      return failure('UPDATE_NOT_READY', 'No downloaded update is ready to install.');
    }
    return success(undefined);
  });
}
