import type { TacticsBridge } from '../../../shared/bridge';

/**
 * `window.tactics` is installed by the preload (src/app/preload/index.ts,
 * E5.3). Declared optional because a broken preload leaves it undefined —
 * the bootstrap surfaces that as the store's error state instead of
 * crashing. This accessor is the IPC layer's single touchpoint with the
 * global; components never read `window.tactics` directly.
 */
declare global {
  interface Window {
    readonly tactics?: TacticsBridge;
  }
}

export function getBridge(): TacticsBridge | undefined {
  return window.tactics;
}
