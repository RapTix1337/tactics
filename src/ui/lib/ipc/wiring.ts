import { useAppStore } from '../../stores/app-store';
import type { IpcWiring } from './bootstrap';

/**
 * The production wiring — the ONLY place mirror stores are written
 * (ADR-033). Feature tasks extend it: each event subscription lands here
 * together with its store slice (settings E8.3, gameState E10.7,
 * updates E18.1).
 */
export const ipcWiring: IpcWiring = {
  subscribeAll: (): void => {
    // No contract events exist yet (EVENT_DOMAINS is empty); the first
    // subscription lands with evt:settings.changed (E8.3).
  },
  applySnapshot: (): void => {
    // The snapshot carries no slices yet (E8.3/E10.7/E18.1) — reaching
    // this point is the successful round trip.
    useAppStore.setState({ ipcStatus: 'ready', lastError: undefined });
  },
  onError: (message): void => {
    useAppStore.setState({ ipcStatus: 'error', lastError: message });
  },
};
