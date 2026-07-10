import type { CommandResult } from '../../../shared/envelope';
import { invokeCommand } from './invoke';

/**
 * The update UI's command functions (E18.2, REL-02). Both mirror nothing:
 * the update store is event-fed (ADR-033) — `updates.check` only
 * acknowledges (the result arrives as `evt:update.changed`), and a
 * successful `updates.install` quits the app. The responses exist for the
 * caller's error handling only (e.g. the named `UPDATE_NOT_READY`).
 */

export async function checkForUpdates(): Promise<CommandResult<void>> {
  return invokeCommand((bridge) => bridge.invoke('updates.check', undefined));
}

export async function installUpdate(): Promise<CommandResult<void>> {
  return invokeCommand((bridge) => bridge.invoke('updates.install', undefined));
}
