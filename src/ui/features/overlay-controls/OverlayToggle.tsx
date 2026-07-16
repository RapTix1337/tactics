import type { JSX } from 'react';
import { useId, useState } from 'react';

import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { closeOverlay, openOverlay } from '../../lib/ipc/overlay';
import { useOverlayStore } from '../../stores/overlay-store';
import { OverlayOpenConfirmDialog } from './OverlayOpenConfirmDialog';

/**
 * The overlay pill toggle for the live page header (OVL.9, spec AC 1/7):
 * reads the overlay mirror and dispatches `overlay.open`/`overlay.close` —
 * no optimistic UI, the switch flips when `evt:overlay.changed` lands in
 * the store (ADR-033). Hidden until the snapshot arrives. Always available
 * on the live view (design §5.4): with no live match the overlay simply
 * shows the no-game state (AC 10). Opening first confirms the supported
 * display modes (OVL.11, ADR-059); closing never asks.
 */
export function OverlayToggle(): JSX.Element | null {
  const switchId = useId();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const open = useOverlayStore((state) => state.overlay?.open);
  if (open === undefined) {
    return null;
  }
  return (
    <div className="flex items-center gap-2.5 rounded-full border bg-input/25 py-1.5 pr-2 pl-3.5">
      <Label htmlFor={switchId}>Overlay</Label>
      <Switch
        id={switchId}
        checked={open}
        onCheckedChange={(checked) => {
          if (checked) {
            setConfirmOpen(true);
            return;
          }
          // The response needs no handling: the store is event-fed, and a
          // failed command leaves the switch on the actual window state.
          void closeOverlay();
        }}
      />
      <OverlayOpenConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={() => {
          void openOverlay();
        }}
      />
    </div>
  );
}
