import { create } from 'zustand';

/**
 * First mirror store, establishing the pattern (ADR-033): written ONLY by
 * the renderer IPC layer (src/ui/lib/ipc); components read via selectors.
 * Tracks the snapshot bootstrap; domain slices get their own stores with
 * their epics (settings E8.3, gameState E10.7, mapCatalog E11.3,
 * updates E18.1).
 */
export type IpcStatus = 'connecting' | 'ready' | 'error';

interface AppState {
  readonly ipcStatus: IpcStatus;
  readonly lastError: string | undefined;
}

export const useAppStore = create<AppState>(() => ({
  ipcStatus: 'connecting',
  lastError: undefined,
}));
