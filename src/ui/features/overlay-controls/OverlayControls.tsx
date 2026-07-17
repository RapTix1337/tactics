import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';

import type { Settings, SettingsUpdate } from '../../../shared/settings';
import { Slider } from '../../components/ui/slider';
import { updateSettings } from '../../lib/ipc/settings';
import { useSettingsStore } from '../../stores/settings-store';

/**
 * The four per-element fade sliders (OVL.12, ADR-060, amended spec AC 4/5):
 * one slider, one layer — Scoreboard, Map, Callouts, Title bar & status —
 * each dispatching exactly its own `settings.update` field. Mounted by both
 * the live-page placeholder and the settings section (design §5.4: one
 * component, two mounts, no drift). Hidden until the settings snapshot
 * arrives.
 */
const FADE_SLIDERS = [
  { field: 'overlayScoreboardOpacity', label: 'Scoreboard' },
  { field: 'overlayMapOpacity', label: 'Map' },
  { field: 'overlayCalloutOpacity', label: 'Callouts' },
  { field: 'overlayChromeOpacity', label: 'Title bar & status' },
] as const;

type FadeField = (typeof FADE_SLIDERS)[number]['field'];

function fadeUpdate(field: FadeField, percent: number): SettingsUpdate {
  const update: Partial<Record<FadeField, number>> = {};
  update[field] = percent / 100;
  return update;
}

export function OverlayControls(): JSX.Element | null {
  const settings = useSettingsStore((state) => state.settings);

  if (settings === undefined) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      {FADE_SLIDERS.map(({ field, label }) => (
        <OpacitySliderRow key={field} field={field} label={label} settings={settings} />
      ))}
    </div>
  );
}

interface OpacitySliderRowProps {
  readonly field: FadeField;
  readonly label: string;
  readonly settings: Settings;
}

/**
 * One fade slider following the ScoreboardSection autosave pattern
 * (maintainer decision at the OVL.9 plan approval, reused for OVL.12): the
 * thumb tracks a local draft for a fluid drag while dispatches go out
 * rAF-throttled (the ResizeHandles contract, ADR-058) so the overlay fades
 * live (AC 4); the release value flushes as the final dispatch and the
 * draft then yields to the store — the settings store itself is only ever
 * written by the IPC event wiring (ADR-033).
 */
function OpacitySliderRow({ field, label, settings }: OpacitySliderRowProps): JSX.Element {
  /** Thumb percent while interacting; `undefined` = show the store value. */
  const [draft, setDraft] = useState<number | undefined>(undefined);
  /** Scheduled dispatch frame; `undefined` while none is pending. */
  const frame = useRef<number | undefined>(undefined);
  const latestPercent = useRef(0);

  // A frame scheduled right before unmount would dispatch from a dead tree.
  useEffect(() => {
    return (): void => {
      if (frame.current !== undefined) {
        cancelAnimationFrame(frame.current);
        frame.current = undefined;
      }
    };
  }, []);

  const percent = draft ?? Math.round(settings[field] * 100);

  const onChange = (values: number[]): void => {
    const value = values[0];
    if (value === undefined) {
      return;
    }
    setDraft(value);
    latestPercent.current = value;
    if (frame.current === undefined) {
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined;
        // Fire-and-forget mid-drag frame: a failure is visible as the
        // overlay not following the thumb; the commit reconciles.
        void updateSettings(fadeUpdate(field, latestPercent.current));
      });
    }
  };

  const onCommit = (values: number[]): void => {
    const value = values[0];
    if (value === undefined) {
      return;
    }
    if (frame.current !== undefined) {
      cancelAnimationFrame(frame.current);
      frame.current = undefined;
    }
    void updateSettings(fadeUpdate(field, value)).then(() => {
      // Settled either way: on success the echoed event carries the value;
      // on failure yielding to the store visibly reverts the thumb.
      setDraft(undefined);
    });
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm leading-none font-medium">{label}</span>
        <span className="text-muted-foreground text-sm tabular-nums">{percent} %</span>
      </div>
      <Slider
        aria-label={`${label} opacity`}
        min={0}
        max={100}
        step={1}
        value={[percent]}
        onValueChange={onChange}
        onValueCommit={onCommit}
      />
    </div>
  );
}
