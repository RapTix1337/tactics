import { create } from 'zustand';

import type { Settings } from '../../shared/settings';

/**
 * Mirror store for the settings domain (ADR-033, 03-technical-design.md §6):
 * written ONLY by the renderer IPC layer (src/ui/lib/ipc) — components read
 * via selectors. `undefined` until the snapshot arrives; every
 * `evt:settings.changed` carries the full new slice.
 */
interface SettingsState {
  readonly settings: Settings | undefined;
}

export const useSettingsStore = create<SettingsState>(() => ({
  settings: undefined,
}));
