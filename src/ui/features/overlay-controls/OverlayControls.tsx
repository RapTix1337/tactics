import type { JSX } from 'react';
import { useEffect, useId, useRef, useState } from 'react';

import { Label } from '../../components/ui/label';
import { Slider } from '../../components/ui/slider';
import { Switch } from '../../components/ui/switch';
import { updateSettings } from '../../lib/ipc/settings';
import { useSettingsStore } from '../../stores/settings-store';

/**
 * The overlay's fade controls (OVL.9, spec AC 4/5): opacity slider plus the
 * two exemption switches, dispatching `settings.update` — mounted by both
 * the live-page placeholder and the settings section (design §5.4: one
 * component, two mounts, no drift). Hidden until the settings snapshot
 * arrives.
 *
 * The slider follows the ScoreboardSection autosave pattern (maintainer
 * decision at plan approval): the thumb tracks a local draft for a fluid
 * drag while dispatches go out rAF-throttled (the ResizeHandles contract,
 * ADR-058) so the overlay fades live (AC 4); the release value flushes as
 * the final dispatch and the draft then yields to the store — the settings
 * store itself is only ever written by the IPC event wiring (ADR-033).
 * The switches are store-driven with no optimistic flip (ADR-033); a failed
 * dispatch leaves them on the persisted state.
 */
export function OverlayControls(): JSX.Element | null {
  const mapSwitchId = useId();
  const scoreboardSwitchId = useId();
  const settings = useSettingsStore((state) => state.settings);
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

  if (settings === undefined) {
    return null;
  }

  const percent = draft ?? Math.round(settings.overlayOpacity * 100);

  const onOpacityChange = (values: number[]): void => {
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
        void updateSettings({ overlayOpacity: latestPercent.current / 100 });
      });
    }
  };

  const onOpacityCommit = (values: number[]): void => {
    const value = values[0];
    if (value === undefined) {
      return;
    }
    if (frame.current !== undefined) {
      cancelAnimationFrame(frame.current);
      frame.current = undefined;
    }
    void updateSettings({ overlayOpacity: value / 100 }).then(() => {
      // Settled either way: on success the echoed event carries the value;
      // on failure yielding to the store visibly reverts the thumb.
      setDraft(undefined);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm leading-none font-medium">Overlay opacity</span>
          <span className="text-muted-foreground text-sm tabular-nums">{percent} %</span>
        </div>
        <Slider
          aria-label="Overlay opacity"
          min={0}
          max={100}
          step={1}
          value={[percent]}
          onValueChange={onOpacityChange}
          onValueCommit={onOpacityCommit}
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="grid gap-1">
          <Label htmlFor={mapSwitchId}>Map always opaque</Label>
          <p id={`${mapSwitchId}-description`} className="text-muted-foreground text-sm">
            Keep the map fully visible while the rest of the overlay fades.
          </p>
        </div>
        <Switch
          id={mapSwitchId}
          aria-describedby={`${mapSwitchId}-description`}
          checked={settings.overlayMapExempt}
          onCheckedChange={(checked) => {
            void updateSettings({ overlayMapExempt: checked });
          }}
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="grid gap-1">
          <Label htmlFor={scoreboardSwitchId}>Scoreboard always opaque</Label>
          <p id={`${scoreboardSwitchId}-description`} className="text-muted-foreground text-sm">
            Keep the scoreboard fully visible while the rest of the overlay fades.
          </p>
        </div>
        <Switch
          id={scoreboardSwitchId}
          aria-describedby={`${scoreboardSwitchId}-description`}
          checked={settings.overlayScoreboardExempt}
          onCheckedChange={(checked) => {
            void updateSettings({ overlayScoreboardExempt: checked });
          }}
        />
      </div>
    </div>
  );
}
