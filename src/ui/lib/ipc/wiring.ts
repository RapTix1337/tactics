import { useAppStore } from '../../stores/app-store';
import { useSettingsStore } from '../../stores/settings-store';
import type { IpcWiring } from './bootstrap';

/**
 * The production wiring — the ONLY place mirror stores are written
 * (ADR-033). Feature tasks extend it: each event subscription lands here
 * together with its store slice (gameState E10.7, updates E18.1).
 */
export const ipcWiring: IpcWiring = {
  subscribeAll: (bridge): void => {
    bridge.subscribe('settings', (settings) => {
      useSettingsStore.setState({ settings });
    });
  },
  applySnapshot: (snapshot): void => {
    // Full slices, so the snapshot may overwrite an earlier event and a
    // later event wins again — both orders converge (04-data-flow.md §4).
    useSettingsStore.setState({ settings: snapshot.settings });
    useAppStore.setState({ ipcStatus: 'ready', lastError: undefined });
  },
  onError: (message): void => {
    useAppStore.setState({ ipcStatus: 'error', lastError: message });
  },
};
