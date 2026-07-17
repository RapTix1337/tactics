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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createProfile } from '@/lib/ipc/map-catalog';

import type { CreateProfileSource, MapSummary } from '../../../shared/map-catalog';

/** The upload choice in the source select; fork values carry the id. */
const UPLOAD_SOURCE = 'upload';
const FORK_PREFIX = 'fork:';

function toCreateProfileSource(value: string): CreateProfileSource {
  return value === UPLOAD_SOURCE
    ? { kind: 'upload' }
    : { kind: 'fork', profileId: value.slice(FORK_PREFIX.length) };
}

export interface CreateProfileDialogProps {
  readonly map: MapSummary;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Prefills the name field (the empty-state upload suggests "Default"). */
  readonly initialName?: string;
  readonly onCreated: (profileId: string) => void;
}

/**
 * The "new profile" dialog (E22.5, MVP-12): names the profile and picks its
 * image source — a fresh upload (native dialog in main, ADR-045) or a fork
 * of an existing profile. Mounted per open (the parent conditions on it), so
 * the field state starts fresh each time. A canceled native dialog keeps
 * this dialog open for another try (the E22.4 `canceled` no-op precedent).
 */
export function CreateProfileDialog({
  map,
  open,
  onOpenChange,
  initialName = '',
  onCreated,
}: CreateProfileDialogProps): JSX.Element {
  const nameId = useId();
  const sourceId = useId();
  const [name, setName] = useState(initialName);
  const [sourceValue, setSourceValue] = useState(UPLOAD_SOURCE);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const trimmedName = name.trim();

  async function handleCreate(): Promise<void> {
    setPending(true);
    setError(undefined);
    const result = await createProfile(map.id, trimmedName, toCreateProfileSource(sourceValue));
    setPending(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    if (result.data.status === 'canceled') {
      return;
    }
    onOpenChange(false);
    onCreated(result.data.profile.id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreate();
          }}
        >
          <DialogHeader>
            <DialogTitle>New profile for {map.displayName}</DialogTitle>
            <DialogDescription>
              A profile bundles one radar image with its callouts. Upload a new image (PNG, JPG or
              SVG) or copy an existing profile — copying duplicates its image and callouts.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={nameId}>Profile name</Label>
            <Input
              id={nameId}
              value={name}
              maxLength={120}
              placeholder="e.g. SimpleRadar"
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </div>
          {map.profiles.length > 0 && (
            <div className="grid gap-2">
              <Label htmlFor={sourceId}>Image source</Label>
              <Select value={sourceValue} onValueChange={setSourceValue}>
                <SelectTrigger id={sourceId} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UPLOAD_SOURCE}>Upload a new image…</SelectItem>
                  {map.profiles.map((profile) => (
                    <SelectItem key={profile.id} value={`${FORK_PREFIX}${profile.id}`}>
                      Copy of “{profile.name}”
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
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
              Create profile
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
