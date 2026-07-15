import type { JSX } from 'react';

import type { GsiConnectionStatus } from '../../../shared/game-state';
import { STATUS_PRESENTATIONS } from '../gsi-status/GsiStatusBadge';

/**
 * The GSI-05 no-game state: what the badge says, spelled out on the page.
 * `connected` with no map is the in-menus case — its badge diagnostic
 * ("Receiving data") would read like a contradiction here, so it gets a
 * specific line instead.
 */
export function NoGameState({ status }: { readonly status: GsiConnectionStatus }): JSX.Element {
  const presentation = STATUS_PRESENTATIONS[status];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
      <p className="font-medium">No game detected</p>
      <p className="max-w-md text-sm text-muted-foreground">
        {status === 'connected'
          ? 'CS2 is connected but no map is active — join a match and it appears here.'
          : `${presentation.label} — ${presentation.diagnostic}`}
      </p>
    </div>
  );
}
