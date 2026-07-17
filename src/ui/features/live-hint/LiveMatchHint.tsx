import { Link, useRouter, useRouterState } from '@tanstack/react-router';
import { XIcon } from 'lucide-react';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useGameStateStore } from '@/stores/game-state-store';
import { useMapCatalogStore } from '@/stores/map-catalog-store';

import type { GameStateMap } from '../../../shared/game-state';

/**
 * The identity of the running match: a new key re-arms the hint after a
 * dismissal, `undefined` (no map) resets it entirely.
 */
function matchKey(map: GameStateMap): string | undefined {
  switch (map.kind) {
    case 'resolved':
      return `resolved:${map.mapId}`;
    case 'unsupported':
      return `unsupported:${map.rawName}`;
    case 'none':
      return undefined;
  }
}

/**
 * The live-mode affordance (E15.4, ADR-046): when a match starts while the
 * user is on another route, an unobtrusive banner offers the jump to `/live`
 * — navigation stays a deliberate user action (ADR-028, no auto-navigation).
 * The hint is acknowledged per match by dismissing it or by visiting `/live`;
 * the match ending (map back to `none`) re-arms it. Acknowledgment is
 * ephemeral renderer state — not domain data (ADR-033). The `role="status"`
 * wrapper stays in the DOM (UI-06): live regions that appear dynamically are
 * not reliably announced, an initially empty one is.
 */
export function LiveMatchHint(): JSX.Element {
  const map = useGameStateStore((state) => state.gameState?.map);
  const router = useRouter();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [acknowledgedKey, setAcknowledgedKey] = useState<string | undefined>(undefined);

  const key = map === undefined ? undefined : matchKey(map);
  const onLive = pathname === '/live';

  // Acknowledgment reacts to the two external systems in their subscription
  // callbacks (not in effect bodies — react-hooks/set-state-in-effect):
  // the game-state store — a match end re-arms the hint, a match that starts
  // or changes while the user is already on /live counts as seen…
  useEffect(() => {
    return useGameStateStore.subscribe((state) => {
      const currentKey = state.gameState === undefined ? undefined : matchKey(state.gameState.map);
      if (currentKey === undefined) {
        setAcknowledgedKey(undefined);
      } else if (router.state.location.pathname === '/live') {
        setAcknowledgedKey(currentKey);
      }
    });
  }, [router]);

  // …and the router — navigating to /live acknowledges the running match.
  useEffect(() => {
    return router.subscribe('onResolved', ({ toLocation }) => {
      if (toLocation.pathname !== '/live') {
        return;
      }
      const { gameState } = useGameStateStore.getState();
      const currentKey = gameState === undefined ? undefined : matchKey(gameState.map);
      if (currentKey !== undefined) {
        setAcknowledgedKey(currentKey);
      }
    });
  }, [router]);

  const resolvedMapId = map?.kind === 'resolved' ? map.mapId : undefined;
  const displayName = useMapCatalogStore((state) =>
    resolvedMapId === undefined
      ? undefined
      : state.list?.find((entry) => entry.id === resolvedMapId)?.displayName,
  );

  const visible = key !== undefined && !onLive && acknowledgedKey !== key;
  // The catalog may not be loaded yet — the mapId is a serviceable fallback.
  const matchName =
    map === undefined || map.kind === 'none'
      ? undefined
      : map.kind === 'resolved'
        ? (displayName ?? map.mapId)
        : map.rawName;

  return (
    <div role="status" aria-label="Live match hint">
      {visible && (
        <div className="flex items-center gap-3 border-b bg-muted/50 px-4 py-2 text-sm">
          <p className="min-w-0 flex-1 truncate">
            Match detected — <span className="font-medium">{matchName}</span>
          </p>
          <Button asChild size="sm" variant="outline">
            <Link to="/live">Go to Live</Link>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="Dismiss match hint"
            onClick={() => {
              setAcknowledgedKey(key);
            }}
          >
            <XIcon aria-hidden="true" className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
