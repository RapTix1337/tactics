import { XIcon } from 'lucide-react';
import type { JSX } from 'react';

import { Button } from '../../components/ui/button';
import { closeOverlay } from '../../lib/ipc/overlay';

/**
 * The overlay's slim window chrome (live-overlay 02-design.md §5.3): a
 * draggable title bar — the frameless window's only move handle — with the
 * ✕ excluded from the drag region so it stays clickable. Part of the base
 * fade region; at 0 % it turns invisible but keeps working (design §6
 * case 5, accepted). The `app-region-*` classes live in overlay.css:
 * `-webkit-app-region` is not part of React's CSSProperties.
 */
export function OverlayChrome(): JSX.Element {
  return (
    <header
      data-testid="overlay-chrome"
      className="app-region-drag flex shrink-0 items-center justify-between rounded-md bg-background/80 px-3 py-1"
      style={{ opacity: 'var(--fade-base)' }}
    >
      <span className="text-xs font-medium text-muted-foreground">TactiCS Overlay</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="app-region-no-drag size-6"
        aria-label="Close overlay"
        onClick={() => {
          // Idempotent on main (02-design.md §6 case 1); a failure leaves
          // the window open, which is its own visible signal — no dialog
          // chrome exists here to show one.
          void closeOverlay();
        }}
      >
        <XIcon />
      </Button>
    </header>
  );
}
