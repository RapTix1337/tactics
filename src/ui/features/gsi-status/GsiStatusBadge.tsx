import type { JSX } from 'react';

import { useGameStateStore } from '@/stores/game-state-store';

import type { GsiConnectionStatus } from '../../../shared/game-state';

interface StatusPresentation {
  readonly label: string;
  readonly diagnostic: string;
  readonly indicatorClass: string;
}

/**
 * One entry per 05-gsi.md §6.1 status: a distinct label, the diagnostic help
 * text (GSI-05), and the indicator color. The color is decorative
 * (aria-hidden) — the label and diagnostic carry the state on their own.
 * Exported for the live page's no-game state (E15.3), which shows the same
 * diagnostics — one wording, two places.
 */
export const STATUS_PRESENTATIONS: Record<GsiConnectionStatus, StatusPresentation> = {
  'not-set-up': {
    label: 'Not set up',
    diagnostic: 'Game State Integration is not set up yet.',
    indicatorClass: 'bg-muted-foreground',
  },
  waiting: {
    label: 'Waiting for data',
    diagnostic: 'No data received — is CS2 running?',
    indicatorClass: 'bg-amber-500',
  },
  connected: {
    label: 'Connected',
    diagnostic: 'Receiving data from CS2.',
    indicatorClass: 'bg-emerald-500',
  },
  stale: {
    label: 'Connection stale',
    diagnostic: 'Data stopped arriving — is CS2 still running?',
    indicatorClass: 'bg-orange-500',
  },
  'repair-needed': {
    label: 'Repair needed',
    diagnostic: 'The GSI config file is missing or outdated.',
    indicatorClass: 'bg-red-500',
  },
};

/**
 * The always-visible GSI connection status badge (GSI-05, 06-ui.md §1),
 * rendered into the sidebar's footer slot. Display-only in E15.1 — the
 * setup/repair dialog behind it is E15.2. The wrapper is a `role="status"`
 * live region (UI-06) and stays in the DOM even before the snapshot has
 * filled the store: live regions that appear dynamically are not reliably
 * announced, an initially empty one is.
 */
export function GsiStatusBadge(): JSX.Element {
  const status = useGameStateStore((state) => state.gameState?.status);
  const presentation = status === undefined ? undefined : STATUS_PRESENTATIONS[status];
  return (
    <div role="status" aria-label="GSI connection status" className="px-2 py-1.5 text-sm">
      {presentation !== undefined && (
        <>
          <span className="flex items-center gap-2 font-medium">
            <span
              aria-hidden="true"
              className={`size-2 shrink-0 rounded-full ${presentation.indicatorClass}`}
            />
            {presentation.label}
          </span>
          <p className="mt-0.5 text-xs text-muted-foreground">{presentation.diagnostic}</p>
        </>
      )}
    </div>
  );
}
