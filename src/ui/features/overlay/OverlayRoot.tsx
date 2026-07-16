import type { CSSProperties, JSX } from 'react';
import { useState } from 'react';

import { useGameStateStore } from '../../stores/game-state-store';
import { useSettingsStore } from '../../stores/settings-store';
import { LiveContent } from '../live-content/LiveContent';
import { OverlayChrome } from './OverlayChrome';
import { OverlayFrame } from './OverlayFrame';
import { ResizeHandles } from './ResizeHandles';

/**
 * React's CSSProperties has no index for custom properties — the three fade
 * variables are typed explicitly instead of widening to a string index.
 */
type OverlayFadeStyle = CSSProperties & {
  readonly '--fade-base': number;
  readonly '--fade-map': number;
  readonly '--fade-scoreboard': number;
};

/** Slider default until the settings snapshot arrives (= the field default). */
const FULL_OPACITY = 1;

/**
 * The overlay window's single view (live-overlay 02-design.md §5.3, ADR-057):
 * derives the three region fade variables from the settings mirror — the
 * slider value as `--fade-base`, exemptions pinning their region to 1 — and
 * renders chrome + the live-view state machine (shared `live-content`,
 * non-interactive) from the same stores as the live page (spec AC 9/10).
 * Fade regions are siblings: the content slot fades with base while a
 * fallback state shows, and hands the fading over to `OverlayFrame`'s
 * regions while the frame is mounted — a faded ancestor would cap the
 * exempted regions (CSS child opacity never exceeds its parent's, AC 5).
 */
export function OverlayRoot(): JSX.Element {
  const settings = useSettingsStore((state) => state.settings);
  const gameState = useGameStateStore((state) => state.gameState);
  const [frameActive, setFrameActive] = useState(false);

  const base = settings?.overlayOpacity ?? FULL_OPACITY;
  const fadeStyle: OverlayFadeStyle = {
    '--fade-base': base,
    '--fade-map': settings?.overlayMapExempt === true ? FULL_OPACITY : base,
    '--fade-scoreboard': settings?.overlayScoreboardExempt === true ? FULL_OPACITY : base,
  };

  return (
    <div data-testid="overlay-root" className="flex h-screen flex-col gap-2 p-2" style={fadeStyle}>
      {/* Outside every fade region: invisible interaction surfaces that must
          keep working at 0 % opacity (design §6 case 5). */}
      <ResizeHandles />
      <OverlayChrome />
      <main
        data-testid="overlay-content"
        className={
          frameActive ? 'min-h-0 flex-1' : 'min-h-0 flex-1 rounded-md border bg-background'
        }
        style={frameActive ? undefined : { opacity: 'var(--fade-base)' }}
      >
        {gameState === undefined ? (
          <p
            role="status"
            className="flex h-full items-center justify-center text-muted-foreground"
          >
            Waiting for game state…
          </p>
        ) : (
          <LiveContent
            status={gameState.status}
            map={gameState.map}
            interactive={false}
            renderMap={(mapId) => <OverlayFrame mapId={mapId} onActiveChange={setFrameActive} />}
          />
        )}
      </main>
    </div>
  );
}
