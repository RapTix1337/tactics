import type { JSX } from 'react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useGameStateStore } from '@/stores/game-state-store';

import type { GsiConnectionStatus } from '../../../shared/game-state';
import { GsiSetupDialog } from './GsiSetupDialog';
import { GsiStatusBadge } from './GsiStatusBadge';

const OPEN_LABELS: Record<GsiConnectionStatus, string> = {
  'not-set-up': 'Set up now',
  waiting: 'GSI setup…',
  connected: 'GSI setup…',
  stale: 'GSI setup…',
  'repair-needed': 'Repair now',
};

/**
 * The sidebar's GSI section (E15.2): the E15.1 badge plus the button that
 * opens the setup/repair dialog — "reachable from the badge" (06-ui.md §2).
 * Nothing is persisted: once set up, the status never reports `not-set-up`
 * again, so the first-start offer disappears by itself.
 */
export function GsiStatusPanel(): JSX.Element {
  const status = useGameStateStore((state) => state.gameState?.status);
  const [userOpen, setUserOpen] = useState(false);
  const [offerDismissed, setOfferDismissed] = useState(false);

  // "Offered on first start" (MVP-02, 06-ui.md §2) as derived state: the
  // status machine reports `not-set-up` only from the startup verify, so
  // this auto-opens exactly when the app starts unconfigured — and only
  // until the user dismisses it once (or setup succeeds and the status
  // moves on). Repair stays one badge click away, never auto-opens (GSI-06).
  const open = userOpen || (status === 'not-set-up' && !offerDismissed);

  function handleOpenChange(next: boolean): void {
    setUserOpen(next);
    if (!next) {
      setOfferDismissed(true);
    }
  }

  return (
    <div>
      <GsiStatusBadge />
      {status !== undefined && (
        <div className="px-2 pb-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => {
              setUserOpen(true);
            }}
          >
            {OPEN_LABELS[status]}
          </Button>
        </div>
      )}
      <GsiSetupDialog
        open={open}
        onOpenChange={handleOpenChange}
        mode={status === 'repair-needed' ? 'repair' : 'setup'}
      />
    </div>
  );
}
