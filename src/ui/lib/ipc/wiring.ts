import { useAppStore } from '@/stores/app-store';
import { useGameStateStore } from '@/stores/game-state-store';
import { useOverlayStore } from '@/stores/overlay-store';
import { useScoreboardStore } from '@/stores/scoreboard-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useUpdateStore } from '@/stores/update-store';

import type { IpcWiring } from './bootstrap';

/**
 * The production wiring — the ONLY place mirror stores are written
 * (ADR-033). Feature tasks extend it: each event subscription lands here
 * together with its store slice.
 */
export const ipcWiring: IpcWiring = {
  subscribeAll: (bridge): void => {
    bridge.subscribe('gameState', (gameState) => {
      useGameStateStore.setState({ gameState });
    });
    bridge.subscribe('settings', (settings) => {
      useSettingsStore.setState({ settings });
    });
    bridge.subscribe('update', (updateState) => {
      useUpdateStore.setState({ updateState });
    });
    bridge.subscribe('scoreboard', (scoreboard) => {
      useScoreboardStore.setState({ scoreboard });
    });
    bridge.subscribe('overlay', (overlay) => {
      useOverlayStore.setState({ overlay });
    });
  },
  applySnapshot: (snapshot): void => {
    // Full slices, so the snapshot may overwrite an earlier event and a
    // later event wins again — both orders converge (04-data-flow.md §4).
    useGameStateStore.setState({ gameState: snapshot.gameState });
    useOverlayStore.setState({ overlay: snapshot.overlay });
    useScoreboardStore.setState({ scoreboard: snapshot.scoreboard });
    useSettingsStore.setState({ settings: snapshot.settings });
    useUpdateStore.setState({ updateState: snapshot.updateState });
    useAppStore.setState({ ipcStatus: 'ready', lastError: undefined });
  },
  onError: (message): void => {
    useAppStore.setState({ ipcStatus: 'error', lastError: message });
  },
};
