import type { JSX } from 'react';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { replaceProfileImage, setDefaultProfile } from '@/lib/ipc/map-catalog';

import type { MapSummary } from '../../../shared/map-catalog';
import { CreateProfileDialog } from './CreateProfileDialog';
import { DeleteProfileDialog } from './DeleteProfileDialog';
import { RenameProfileDialog } from './RenameProfileDialog';

type ProfileDialog = 'create' | 'rename' | 'delete';

export interface MapProfileManagerProps {
  /** A map with at least one profile — the empty state is `MapEmptyState`. */
  readonly map: MapSummary;
  /** The profile the map view shows (explicit selection or resolved default). */
  readonly displayedProfileId: string;
  readonly onSelectProfile: (profileId: string) => void;
  /** A created profile becomes the displayed one. */
  readonly onProfileCreated: (profileId: string) => void;
  /** A same-extension replace keeps the URL — the parent remounts the view. */
  readonly onImageReplaced: () => void;
}

/**
 * The profile toolbar of the map page (E22.5, MVP-12, 06-ui.md §2): switch
 * the displayed profile, set the default, and reach the create/rename/delete
 * dialogs and the image replace flow — all through the E22.3 commands, whose
 * responses refresh the catalog store (ADR-033, no optimistic UI). One
 * pending slot serializes the direct actions (set default, replace) — the
 * dialogs are modal, so they cannot overlap them.
 */
export function MapProfileManager({
  map,
  displayedProfileId,
  onSelectProfile,
  onProfileCreated,
  onImageReplaced,
}: MapProfileManagerProps): JSX.Element | null {
  const switcherId = useId();
  const [openDialog, setOpenDialog] = useState<ProfileDialog | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const displayedProfile = map.profiles.find((profile) => profile.id === displayedProfileId);

  async function handleSetDefault(): Promise<void> {
    setPending(true);
    setActionError(undefined);
    const result = await setDefaultProfile(map.id, displayedProfileId);
    setPending(false);
    if (!result.ok) {
      setActionError(result.error.message);
    }
  }

  async function handleReplaceImage(): Promise<void> {
    setPending(true);
    setActionError(undefined);
    const result = await replaceProfileImage(map.id, displayedProfileId);
    setPending(false);
    if (!result.ok) {
      setActionError(result.error.message);
      return;
    }
    // `canceled` is a no-op (the E22.4 precedent).
    if (result.data.status === 'replaced') {
      onImageReplaced();
    }
  }

  function handleDialogOpenChange(open: boolean): void {
    if (!open) {
      setOpenDialog(undefined);
    }
  }

  if (displayedProfile === undefined) {
    // Unreachable via the map page (it derives the displayed id from the
    // summary), but a typed guard beats a non-null assertion.
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor={switcherId}>Profile</Label>
      <Select value={displayedProfileId} onValueChange={onSelectProfile} disabled={pending}>
        <SelectTrigger id={switcherId} size="sm" className="min-w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {map.profiles.map((profile) => (
            <SelectItem key={profile.id} value={profile.id}>
              {profile.id === map.defaultProfileId ? `${profile.name} (default)` : profile.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending || displayedProfileId === map.defaultProfileId}
        onClick={() => {
          void handleSetDefault();
        }}
      >
        Set as default
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          setActionError(undefined);
          setOpenDialog('create');
        }}
      >
        New profile…
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          void handleReplaceImage();
        }}
      >
        Replace image…
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          setActionError(undefined);
          setOpenDialog('rename');
        }}
      >
        Rename…
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          setActionError(undefined);
          setOpenDialog('delete');
        }}
      >
        Delete…
      </Button>
      {actionError !== undefined && (
        <p role="alert" className="w-full text-sm text-destructive">
          {actionError}
        </p>
      )}
      {openDialog === 'create' && (
        <CreateProfileDialog
          map={map}
          open
          onOpenChange={handleDialogOpenChange}
          onCreated={onProfileCreated}
        />
      )}
      {openDialog === 'rename' && (
        <RenameProfileDialog
          mapId={map.id}
          profile={displayedProfile}
          open
          onOpenChange={handleDialogOpenChange}
        />
      )}
      {openDialog === 'delete' && (
        <DeleteProfileDialog
          mapId={map.id}
          profile={displayedProfile}
          isLastProfile={map.profiles.length === 1}
          open
          onOpenChange={handleDialogOpenChange}
        />
      )}
    </div>
  );
}
