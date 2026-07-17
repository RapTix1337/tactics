import type { JSX } from 'react';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { renameProfile } from '@/lib/ipc/map-catalog';

import type { MapProfileSummary } from '../../../shared/map-catalog';

export interface RenameProfileDialogProps {
  readonly mapId: string;
  readonly profile: MapProfileSummary;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * The rename dialog (E22.5, MVP-12): mounted per open (the parent conditions
 * on it), so the field starts at the profile's current name each time.
 */
export function RenameProfileDialog({
  mapId,
  profile,
  open,
  onOpenChange,
}: RenameProfileDialogProps): JSX.Element {
  const nameId = useId();
  const [name, setName] = useState(profile.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const trimmedName = name.trim();

  async function handleRename(): Promise<void> {
    setPending(true);
    setError(undefined);
    const result = await renameProfile(mapId, profile.id, trimmedName);
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
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleRename();
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename profile</DialogTitle>
            <DialogDescription>
              Renaming “{profile.name}” keeps its image and callouts.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={nameId}>Profile name</Label>
            <Input
              id={nameId}
              value={name}
              maxLength={120}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </div>
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
            <Button type="submit" disabled={pending || trimmedName === ''}>
              Rename profile
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
