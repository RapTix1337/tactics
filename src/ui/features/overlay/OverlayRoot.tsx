import type { CSSProperties, JSX } from 'react';
import { useState } from 'react';

import { useGameStateStore } from '../../stores/game-state-store';
import { useSettingsStore } from '../../stores/settings-store';
import { LiveContent } from '../live-content/LiveContent';
import { OverlayChrome } from './OverlayChrome';
import { OverlayFrame } from './OverlayFrame';
import { OverlayIdlePlaceholder } from './OverlayIdlePlaceholder';
import { ResizeHandles } from './ResizeHandles';

/**
 * React's CSSProperties has no index for custom properties — the four fade
 * variables are typed explicitly instead of widening to a string index.
 */
type OverlayFadeStyle = CSSProperties & {
  readonly '--fade-scoreboard': number;
  readonly '--fade-map': number;
  readonly '--fade-callouts': number;
  readonly '--fade-chrome': number;
};

/** Slider default until the settings snapshot arrives (= the field default). */
const FULL_OPACITY = 1;

/**
 * The overlay window's single view (live-overlay 02-design.md §5.3, ADR-057):
 * sets the four per-element fade variables straight from the settings mirror
 * (ADR-060 — one slider, one layer, no exemption logic) and renders chrome +
 * the live-view state machine (shared `live-content`, non-interactive) from
 * the same stores as the live page (spec AC 9/10). Fade regions are
 * siblings: the content slot (the black idle placeholder, which stands in for
 * the map) fades with the map slider while a non-map state shows — never
 * chrome, or an activated overlay would vanish whenever chrome is kept low
 * (ADR-062) — and hands the fading over to `OverlayFrame`'s regions while the
 * frame is mounted — a faded ancestor would cap the brighter regions (CSS
 * child opacity never exceeds its parent's, AC 5). The map and callout
 * variables are consumed inside the shared `MapView` (fallback 1 keeps the
 * main window untouched).
 */
export function OverlayRoot(): JSX.Element {
  const settings = useSettingsStore((state) => state.settings);
  const gameState = useGameStateStore((state) => state.gameState);
  const [frameActive, setFrameActive] = useState(false);

  const fadeStyle: OverlayFadeStyle = {
    '--fade-scoreboard': settings?.overlayScoreboardOpacity ?? FULL_OPACITY,
    '--fade-map': settings?.overlayMapOpacity ?? FULL_OPACITY,
    '--fade-callouts': settings?.overlayCalloutOpacity ?? FULL_OPACITY,
    '--fade-chrome': settings?.overlayChromeOpacity ?? FULL_OPACITY,
  };

  return (
    <div data-testid="overlay-root" className="flex h-screen flex-col gap-2 p-2" style={fadeStyle}>
      {/* Outside every fade region: invisible interaction surfaces that must
          keep working at 0 % opacity (design §6 case 5). */}
      <ResizeHandles />
      <OverlayChrome />
      {/* The idle placeholder stands in for the map, so the content slot fades
          with the map slider — never chrome (ADR-062). Chrome is routinely kept
          low for a see-through title bar; coupling the placeholder to it made an
          activated overlay vanish in the menu. While the frame is mounted it
          owns its own per-region fades, so the slot opacity is lifted. */}
      <main
        data-testid="overlay-content"
        className="min-h-0 flex-1"
        style={frameActive ? undefined : { opacity: 'var(--fade-map)' }}
      >
        {gameState === undefined ? (
          <OverlayIdlePlaceholder />
        ) : (
          <LiveContent
            status={gameState.status}
            map={gameState.map}
            interactive={false}
            renderMap={(mapId) => <OverlayFrame mapId={mapId} onActiveChange={setFrameActive} />}
            fallback={<OverlayIdlePlaceholder />}
          />
        )}
      </main>
    </div>
  );
}
