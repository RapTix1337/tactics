import { create } from 'zustand';

import type { GameState } from '../../shared/game-state';

/**
 * Mirror store for the gameState domain (ADR-033, 03-technical-design.md §6):
 * written ONLY by the renderer IPC layer (src/ui/lib/ipc) — components read
 * via selectors. `undefined` until the snapshot arrives; every
 * `evt:gameState.changed` carries the full new slice.
 */
interface GameStateState {
  readonly gameState: GameState | undefined;
}

export const useGameStateStore = create<GameStateState>(() => ({
  gameState: undefined,
}));
