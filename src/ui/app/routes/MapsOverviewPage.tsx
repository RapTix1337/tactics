import type { JSX } from 'react';

import { MapsOverview } from '../../features/map-manage/MapsOverview';

/**
 * `/maps` (06-ui.md §2): the app home (MVP-11) — the map-manage feature
 * renders the catalog with upload state and the upload flow (E22.4).
 */
export function MapsOverviewPage(): JSX.Element {
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <h1 className="text-2xl font-semibold">Maps</h1>
      <MapsOverview />
    </div>
  );
}
