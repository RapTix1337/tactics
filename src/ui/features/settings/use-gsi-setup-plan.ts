import { useEffect, useState } from 'react';

import type { ReadyGsiSetupPlan } from '@/lib/ipc/gsi-setup';
import { loadGsiSetupPlan } from '@/lib/ipc/gsi-setup';
import { useSettingsStore } from '@/stores/settings-store';

/** The settings sections' view of `gsi.getSetupPlan` (E16.2). */
export type GsiSetupPlanView =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly plan: ReadyGsiSetupPlan }
  | { readonly phase: 'not-found' }
  | { readonly phase: 'error'; readonly message: string };

/** A settled fetch, tagged with the inputs it answered — "loading" is derived
 * from a tag mismatch instead of set imperatively (the E15.2 dialog pattern,
 * required by `react-hooks/set-state-in-effect`). */
interface ResolvedPlan {
  readonly request: number;
  readonly cs2Path: string | null | undefined;
  readonly gsiPort: number | null | undefined;
  readonly state: Exclude<GsiSetupPlanView, { readonly phase: 'loading' }>;
}

function toPlanView(result: Awaited<ReturnType<typeof loadGsiSetupPlan>>): ResolvedPlan['state'] {
  if (!result.ok) {
    return { phase: 'error', message: result.error.message };
  }
  if (result.data.status === 'ready') {
    return { phase: 'ready', plan: result.data };
  }
  return { phase: 'not-found' };
}

/**
 * Fetches `gsi.getSetupPlan` for the settings page (E16.2): the plan carries
 * the effective CS2 path with its source and the effective port. Re-fetches
 * whenever the settings slice's `cs2Path`/`gsiPort` change — those land via
 * `evt:settings.changed` (ADR-033), so a manual pick or port change refreshes
 * the view without any imperative plumbing.
 */
export function useGsiSetupPlan(): {
  readonly plan: GsiSetupPlanView;
  readonly refetch: () => void;
} {
  const cs2Path = useSettingsStore((state) => state.settings?.cs2Path);
  const gsiPort = useSettingsStore((state) => state.settings?.gsiPort);
  const [request, setRequest] = useState(0);
  const [resolved, setResolved] = useState<ResolvedPlan | undefined>(undefined);

  const plan: GsiSetupPlanView =
    resolved !== undefined &&
    resolved.request === request &&
    resolved.cs2Path === cs2Path &&
    resolved.gsiPort === gsiPort
      ? resolved.state
      : { phase: 'loading' };

  useEffect(() => {
    // The cleanup also cancels superseded fetches: a dependency change
    // re-runs the effect, so an older in-flight answer never lands.
    let alive = true;
    void loadGsiSetupPlan().then((result) => {
      if (alive) {
        setResolved({ request, cs2Path, gsiPort, state: toPlanView(result) });
      }
    });
    return (): void => {
      alive = false;
    };
  }, [request, cs2Path, gsiPort]);

  return {
    plan,
    refetch: (): void => {
      setRequest((value) => value + 1);
    },
  };
}
