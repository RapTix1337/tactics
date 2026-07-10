import type { CommandResult } from '../../../shared/envelope';
import type { Settings, SettingsUpdate } from '../../../shared/settings';
import { invokeCommand } from './invoke';

/**
 * The settings form's command function (E16.1, 06-ui.md §2). Mirrors nothing:
 * the settings store is event-fed (ADR-033) — main persists, publishes
 * `evt:settings.changed`, and the wiring writes the store. The response
 * exists for the caller's error handling only.
 */
export async function updateSettings(update: SettingsUpdate): Promise<CommandResult<Settings>> {
  return invokeCommand((bridge) => bridge.invoke('settings.update', update));
}
