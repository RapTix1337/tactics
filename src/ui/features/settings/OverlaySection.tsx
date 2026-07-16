import type { JSX } from 'react';

import { useSettingsStore } from '../../stores/settings-store';
import { OverlayControls } from '../overlay-controls/OverlayControls';

/**
 * The overlay settings section (OVL.9, live-overlay 02-design.md §5.4):
 * mounts the same `OverlayControls` as the live-page placeholder — one
 * component, two mounts, no drift (maintainer decision: both surfaces).
 * The Fullscreen Windowed hint reflects ADR-059 (exclusive fullscreen
 * unsupported); OVL.11 adds the active warn-on-open.
 */
export function OverlaySection(): JSX.Element {
  const settingsLoaded = useSettingsStore((state) => state.settings !== undefined);

  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <h2 className="text-lg font-medium">Overlay</h2>
      <p className="text-muted-foreground text-sm">
        The transparent always-on-top window showing the live map and scoreboard. Open and close it
        from the live page; tune how strongly it fades here or there. Run CS2 in Fullscreen Windowed
        — in exclusive Fullscreen the overlay cannot display and interrupts the game.
      </p>
      {settingsLoaded ? (
        <OverlayControls />
      ) : (
        <p className="text-muted-foreground">Loading settings…</p>
      )}
    </section>
  );
}
