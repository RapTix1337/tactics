import type { JSX } from 'react';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { updateSettings } from '@/lib/ipc/settings';
import { useGameStateStore } from '@/stores/game-state-store';
import { useSettingsStore } from '@/stores/settings-store';

import type { GsiTiming } from '../../../shared/settings';
import { GSI_TIMINGS } from '../../../shared/settings';
import { GSI_RESTART_NOTICE } from '../gsi-status/GsiSetupDialog';
import { STATUS_PRESENTATIONS } from '../gsi-status/GsiStatusBadge';

/** The ADR-051 profiles, worded for users — no raw buffer/throttle values
 * (live-scoreboard 02-design.md §5: fixed presets, no timing inputs). */
const PROFILE_ROWS: ReadonlyArray<{
  value: GsiTiming;
  label: string;
  description: string;
}> = [
  {
    value: 'slow',
    label: 'Slow',
    description: 'Fewer updates from CS2 — the lightest option.',
  },
  {
    value: 'default',
    label: 'Default',
    description: 'Balanced updates — recommended.',
  },
  {
    value: 'fast',
    label: 'Fast',
    description: 'The most responsive scoreboard, the most frequent updates.',
  },
];

function isGsiTiming(value: string): value is GsiTiming {
  return (GSI_TIMINGS as readonly string[]).includes(value);
}

export interface GsiTimingSectionProps {
  /** Opens the E15.2 dialog in repair mode — owned by the page, the dialog
   * belongs to the `gsi-status` feature (03-technical-design.md §3.1). */
  readonly onRepair: () => void;
}

/**
 * The advanced GSI timing section of the settings page (SCB.11, spec AC 12):
 * one of the three ADR-051 profiles, saved on select via `settings.update`.
 * The radios are bound to the store slice, so the selection moves only when
 * `evt:settings.changed` lands — no optimistic UI (ADR-033). A profile change
 * makes the written config outdated; main's re-verify flips the status to
 * repair-needed and this section points to the existing repair flow instead
 * of duplicating it (GSI-04/06).
 */
export function GsiTimingSection({ onRepair }: GsiTimingSectionProps): JSX.Element {
  const gsiTiming = useSettingsStore((state) => state.settings?.gsiTiming);
  const repairNeeded = useGameStateStore((state) => state.gameState?.status === 'repair-needed');
  const baseId = useId();
  const [error, setError] = useState<string | undefined>(undefined);

  if (gsiTiming === undefined) {
    return (
      <section className="flex max-w-xl flex-col gap-3">
        <h2 className="text-lg font-medium">GSI timing</h2>
        <p className="text-muted-foreground">Loading settings…</p>
      </section>
    );
  }

  async function handleSelect(value: string): Promise<void> {
    if (!isGsiTiming(value) || value === gsiTiming) {
      return;
    }
    setError(undefined);
    const result = await updateSettings({ gsiTiming: value });
    if (!result.ok) {
      setError(result.error.message);
    }
    // Success needs no handling: the wiring applies `evt:settings.changed`
    // to the store and the radios follow the new slice.
  }

  return (
    <section className="flex max-w-xl flex-col gap-3">
      <h2 className="text-lg font-medium">GSI timing</h2>
      <p className="text-muted-foreground text-sm">
        Advanced: how often CS2 reports game state. Changing the profile makes an already written
        GSI config outdated — repair the config afterwards. {GSI_RESTART_NOTICE}
      </p>
      <RadioGroup
        aria-label="GSI timing profile"
        value={gsiTiming}
        onValueChange={(value) => {
          void handleSelect(value);
        }}
      >
        {PROFILE_ROWS.map((row) => (
          <div key={row.value} className="flex items-start gap-3">
            <RadioGroupItem
              id={`${baseId}-${row.value}`}
              value={row.value}
              aria-describedby={`${baseId}-${row.value}-description`}
              className="mt-0.5"
            />
            <div className="grid gap-1">
              <Label htmlFor={`${baseId}-${row.value}`}>{row.label}</Label>
              <p
                id={`${baseId}-${row.value}-description`}
                className="text-muted-foreground text-sm"
              >
                {row.description}
              </p>
            </div>
          </div>
        ))}
      </RadioGroup>
      {error !== undefined && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {repairNeeded && (
        <div className="flex items-center justify-between gap-4 rounded-md border p-3">
          <p className="text-sm">{STATUS_PRESENTATIONS['repair-needed'].diagnostic}</p>
          <Button type="button" variant="outline" onClick={onRepair}>
            Repair now
          </Button>
        </div>
      )}
    </section>
  );
}
