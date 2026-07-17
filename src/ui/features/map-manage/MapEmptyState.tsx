import type { JSX } from 'react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

import type { MapSummary } from '../../../shared/map-catalog';
import { CreateProfileDialog } from './CreateProfileDialog';

export interface MapEmptyStateProps {
  /** A map without profiles — with profiles the page shows the manager. */
  readonly map: MapSummary;
  readonly onProfileCreated: (profileId: string) => void;
}

/**
 * The map page's empty/upload state (E22.5, MVP-12): shown while the map has
 * no profiles — on first visit and again after the last profile was deleted.
 * The upload affordance opens the create dialog with "Default" suggested,
 * matching the overview's one-click upload name (E22.4).
 */
export function MapEmptyState({ map, onProfileCreated }: MapEmptyStateProps): JSX.Element {
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
      <p className="font-medium">No image yet</p>
      <p className="max-w-md text-sm text-muted-foreground">
        {map.displayName} has no radar image. Upload a screenshot of the in-game overview map or a
        community radar image (PNG, JPG or SVG) to use this map.
      </p>
      <Button
        type="button"
        className="mt-2"
        onClick={() => {
          setDialogOpen(true);
        }}
      >
        Upload image…
      </Button>
      {dialogOpen && (
        <CreateProfileDialog
          map={map}
          open
          onOpenChange={setDialogOpen}
          initialName="Default"
          onCreated={onProfileCreated}
        />
      )}
    </div>
  );
}
