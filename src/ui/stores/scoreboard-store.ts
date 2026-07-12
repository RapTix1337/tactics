import { create } from 'zustand';

import type { ScoreboardState } from '../../shared/scoreboard-state';

/**
 * Mirror store for the scoreboard domain (ADR-033, 03-technical-design.md
 * §6, SCB.7): written ONLY by the renderer IPC layer (src/ui/lib/ipc) —
 * components read via selectors. `undefined` until the snapshot arrives;
 * every `evt:scoreboard.changed` carries the full new slice.
 */
interface ScoreboardStoreState {
  readonly scoreboard: ScoreboardState | undefined;
}

export const useScoreboardStore = create<ScoreboardStoreState>(() => ({
  scoreboard: undefined,
}));
