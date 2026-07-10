import { create } from 'zustand';

import type { UpdateState } from '../../shared/update-state';

/**
 * Mirror store for the update domain (ADR-033, 03-technical-design.md §6):
 * written ONLY by the renderer IPC layer (src/ui/lib/ipc) — components read
 * via selectors. `undefined` until the snapshot arrives; every
 * `evt:update.changed` carries the full new slice.
 */
interface UpdateStoreState {
  readonly updateState: UpdateState | undefined;
}

export const useUpdateStore = create<UpdateStoreState>(() => ({
  updateState: undefined,
}));
