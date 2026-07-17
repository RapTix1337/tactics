import type { JSX } from 'react';
import { useState } from 'react';

import { PROJECT_REPOSITORY_URL } from '../../../shared/external-urls';
import { Button } from '../../components/ui/button';
import { openExternal } from '../../lib/ipc/external-links';

/**
 * The MVP-09 unknown-map state: the raw GSI name is informative, and map
 * support is data-driven (MAP-02) — the contribute link opens the project
 * repository via the allowlisted `app.openExternal` (ADR-036); the
 * non-interactive variant carries the text only.
 */
export function UnsupportedMapState({
  rawName,
  interactive,
}: {
  readonly rawName: string;
  readonly interactive: boolean;
}): JSX.Element {
  const [openFailure, setOpenFailure] = useState<string | undefined>(undefined);

  async function handleOpenRepository(): Promise<void> {
    const result = await openExternal(PROJECT_REPOSITORY_URL);
    setOpenFailure(result.ok ? undefined : result.error.message);
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
      <p className="font-medium">Unsupported map</p>
      <p className="max-w-md text-sm text-muted-foreground">
        CS2 reports <span className="font-mono break-all">{rawName}</span>, which is not in the map
        catalog. Maps are data, not code — new ones can be contributed to the project.
      </p>
      {interactive && (
        <Button
          type="button"
          variant="outline"
          className="mt-2"
          onClick={() => {
            void handleOpenRepository();
          }}
        >
          Open project repository
        </Button>
      )}
      {openFailure !== undefined && (
        <p role="alert" className="text-sm text-destructive">
          {openFailure}
        </p>
      )}
    </div>
  );
}
