import type { JSX } from 'react';
import { useState } from 'react';

import type { MapProfileSummary } from '../../../shared/map-catalog';
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
import { deleteProfile } from '../../lib/ipc/map-catalog';

export interface DeleteProfileDialogProps {
  readonly mapId: string;
  readonly profile: MapProfileSummary;
  /** Deleting the last profile returns the map to its empty state (MVP-12). */
  readonly isLastProfile: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * The delete confirmation (E22.5, MVP-12): deleting removes the profile's
 * image file and callouts permanently, so it is never a one-click action.
 */
export function DeleteProfileDialog({
  mapId,
  profile,
  isLastProfile,
  open,
  onOpenChange,
}: DeleteProfileDialogProps): JSX.Element {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleDelete(): Promise<void> {
    setPending(true);
    setError(undefined);
    const result = await deleteProfile(mapId, profile.id);
    setPending(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete profile “{profile.name}”?</DialogTitle>
          <DialogDescription>
            This permanently removes the profile’s image and callouts.
            {isLastProfile && ' It is the map’s last profile — the map returns to its empty state.'}
          </DialogDescription>
        </DialogHeader>
        {error !== undefined && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => {
              void handleDelete();
            }}
          >
            Delete profile
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
