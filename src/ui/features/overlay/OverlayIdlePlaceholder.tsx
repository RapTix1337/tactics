import type { JSX } from 'react';

/**
 * The overlay's idle placeholder (live-overlay enhancement, ADR-062): whenever
 * the overlay has no usable map to draw — main menu, unsupported map, catalog
 * loading/error, or before the first game-state slice — it shows a clean black
 * panel instead of the live page's diagnostic states. This is the overlay's
 * deliberate deviation from spec AC 10 (the main live page keeps its
 * diagnostics): an activated overlay stays visually present at all times
 * rather than surfacing "No game detected" over the game. A faint hint keeps
 * it legible as "alive, waiting" rather than broken.
 *
 * The panel carries no opacity of its own: while no map frame is mounted the
 * `OverlayRoot` content slot fades it with `var(--fade-map)` — the placeholder
 * stands in for the map, so it follows the map slider (kept visible), never the
 * chrome slider (routinely kept low, which would make an activated overlay
 * vanish in the menu — ADR-062).
 */
export function OverlayIdlePlaceholder(): JSX.Element {
  return (
    <div
      data-testid="overlay-idle-placeholder"
      className="flex h-full items-center justify-center rounded-md bg-black p-4"
    >
      <p role="status" className="text-sm text-white/40">
        Waiting for match…
      </p>
    </div>
  );
}
