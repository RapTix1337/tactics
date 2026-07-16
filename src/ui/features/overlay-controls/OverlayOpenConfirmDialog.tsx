import type { JSX } from 'react';

import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';

export interface OverlayOpenConfirmDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Called once when the player confirms; the caller dispatches `overlay.open`. */
  readonly onConfirm: () => void;
}

/**
 * The warn-on-open confirmation (OVL.11, ADR-059): shown on every overlay
 * open — deliberately without display-mode detection or a "don't show
 * again" — so the player learns the supported modes before the overlay can
 * disturb an exclusive-fullscreen game.
 */
export function OverlayOpenConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
}: OverlayOpenConfirmDialogProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open the overlay?</DialogTitle>
          <DialogDescription>
            The overlay is supported for CS2 in Windowed and Fullscreen Windowed mode. In exclusive
            Fullscreen the game is forced out of exclusive mode while the overlay is open; closing
            it restores normal exclusive play.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
