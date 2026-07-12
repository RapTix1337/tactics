import type { JSX } from 'react';
import { useEffect, useId, useState } from 'react';

import type { ScoreboardLayout, Settings } from '../../../shared/settings';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { updateSettings } from '../../lib/ipc/settings';
import { useSettingsStore } from '../../stores/settings-store';
import { MyPerformanceCard } from '../scoreboard/MyPerformanceCard';
import { SAMPLE_SCOREBOARD_STATE } from '../scoreboard/sample-state';
import type { DraftLayout } from './scoreboard-builder-model';
import { layoutsEqual, toDraft, toLayout } from './scoreboard-builder-model';
import { ScoreboardBuilder } from './ScoreboardBuilder';

/**
 * The scoreboard settings section (SCB.10, live-scoreboard 02-design.md §5):
 * enable switch (mirrors the live page toggle), the dnd-kit builder, and a
 * live preview rendering the real `MyPerformanceCard` with sample data — one
 * component, no drift. Builder edits autosave per completed mutation
 * (maintainer decision at plan approval): the draft applies locally for a
 * fluid drag experience, every commit goes through `settings.update`, and a
 * failed save reverts the draft to the persisted layout — the settings store
 * itself is only ever written by the IPC event wiring (ADR-033).
 */
export function ScoreboardSection(): JSX.Element {
  const settings = useSettingsStore((state) => state.settings);

  if (settings === undefined) {
    return (
      <section className="flex max-w-2xl flex-col gap-3">
        <h2 className="text-lg font-medium">Scoreboard</h2>
        <p className="text-muted-foreground">Loading settings…</p>
      </section>
    );
  }
  return <ScoreboardFields settings={settings} />;
}

function ScoreboardFields({ settings }: { readonly settings: Settings }): JSX.Element {
  const switchId = useId();
  const [error, setError] = useState<string | undefined>(undefined);
  const persistedLayout = settings.scoreboardLayout;
  const [draft, setDraft] = useState<DraftLayout>(() => toDraft(persistedLayout));

  // Re-initialize the draft only when the persisted layout structurally
  // diverges — the echo of our own autosave must not remount the builder
  // (fresh group ids would drop focus mid-interaction). Subscription instead
  // of effect-derived state: the store is the external system here.
  useEffect(() => {
    return useSettingsStore.subscribe((state) => {
      const layout = state.settings?.scoreboardLayout;
      if (layout === undefined) {
        return;
      }
      setDraft((current) => (layoutsEqual(toLayout(current), layout) ? current : toDraft(layout)));
    });
  }, []);

  async function persistDraft(next: DraftLayout, revertTo: ScoreboardLayout): Promise<void> {
    setError(undefined);
    setDraft(next);
    const result = await updateSettings({ scoreboardLayout: toLayout(next) });
    if (!result.ok) {
      setError(result.error.message);
      setDraft(toDraft(revertTo));
    }
    // Success needs no handling: `evt:settings.changed` lands in the store
    // and the draft-sync effect sees a structurally equal layout.
  }

  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <h2 className="text-lg font-medium">Scoreboard</h2>
      <p className="text-muted-foreground text-sm">
        The live scoreboard shows your own player only — CS2 game state integration doesn&apos;t
        report other players. Choose which of your stats appear and how they&apos;re grouped.
      </p>
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-1">
          <Label htmlFor={switchId}>Show scoreboard on the live map</Label>
          <p id={`${switchId}-description`} className="text-muted-foreground text-sm">
            Overlay your performance panel beside the map during a match.
          </p>
        </div>
        <Switch
          id={switchId}
          aria-describedby={`${switchId}-description`}
          checked={settings.scoreboardEnabled}
          onCheckedChange={(checked) => {
            // Like the live page toggle: the store is event-fed, a failed
            // update simply leaves the switch on the persisted state.
            void updateSettings({ scoreboardEnabled: checked });
          }}
        />
      </div>
      <ScoreboardBuilder
        draft={draft}
        onDraftChange={(next) => {
          void persistDraft(next, persistedLayout);
        }}
      />
      {error !== undefined && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          Preview
          <span className="ml-2 font-normal normal-case tracking-normal">
            — the live &quot;My performance&quot; card with sample data
          </span>
        </span>
        <div className="max-w-[300px]">
          <MyPerformanceCard layout={toLayout(draft)} state={SAMPLE_SCOREBOARD_STATE} />
        </div>
      </div>
    </section>
  );
}
