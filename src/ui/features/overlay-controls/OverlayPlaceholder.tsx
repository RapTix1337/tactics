import { ExternalLinkIcon } from 'lucide-react';
import type { JSX } from 'react';

import { Button } from '../../components/ui/button';
import { closeOverlay } from '../../lib/ipc/overlay';
import { OverlayControls } from './OverlayControls';

/**
 * The live page's content area while the overlay is open (OVL.9, spec
 * AC 1/7): the live content renders only in the overlay window, so this
 * placeholder holds its seat — with the close control and the shared
 * `OverlayControls`, so fade and exemptions are adjustable right where the
 * content went missing (design §5.4).
 */
export function OverlayPlaceholder(): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-4">
      <div className="flex flex-col items-center gap-2 text-center">
        <ExternalLinkIcon aria-hidden className="text-muted-foreground size-8" />
        <p className="text-lg font-medium">Shown in overlay</p>
        <p className="text-muted-foreground text-sm">
          The live view is displayed in the overlay window.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            // Idempotent on main (02-design.md §6 case 1); the placeholder
            // yields when `evt:overlay.changed` reports the window closed.
            void closeOverlay();
          }}
        >
          Close overlay
        </Button>
      </div>
      <div className="w-full max-w-sm">
        <OverlayControls />
      </div>
    </div>
  );
}
