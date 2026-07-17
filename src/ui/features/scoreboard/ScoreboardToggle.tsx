import type { JSX } from 'react';
import { useId } from 'react';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { updateSettings } from '@/lib/ipc/settings';
import { useSettingsStore } from '@/stores/settings-store';

/**
 * The scoreboard pill toggle for the live page header (SCB.8, spec AC 1):
 * reads `scoreboardEnabled` from the settings mirror and dispatches
 * `settings.update` — no optimistic UI, the switch flips when
 * `evt:settings.changed` lands in the store (ADR-033). Hidden until the
 * settings snapshot arrives. Placement on the page is SCB.9.
 */
export function ScoreboardToggle(): JSX.Element | null {
  const switchId = useId();
  const enabled = useSettingsStore((state) => state.settings?.scoreboardEnabled);
  if (enabled === undefined) {
    return null;
  }
  return (
    <div className="flex items-center gap-2.5 rounded-full border bg-input/25 py-1.5 pr-2 pl-3.5">
      <Label htmlFor={switchId}>Scoreboard</Label>
      <Switch
        id={switchId}
        checked={enabled}
        onCheckedChange={(checked) => {
          // The response needs no handling: the store is event-fed, and a
          // failed update simply leaves the switch on the persisted state.
          void updateSettings({ scoreboardEnabled: checked });
        }}
      />
    </div>
  );
}
