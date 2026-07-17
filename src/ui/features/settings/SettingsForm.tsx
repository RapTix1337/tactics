import { zodResolver } from '@hookform/resolvers/zod';
import type { JSX } from 'react';
import { useId, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { updateSettings } from '@/lib/ipc/settings';
import { useSettingsStore } from '@/stores/settings-store';

import type { Settings } from '../../../shared/settings';
import { SETTINGS_FIELD_SCHEMAS } from '../../../shared/settings';

/**
 * The four E16.1 fields of 01-requirements.md §9 — the shared per-field
 * schemas are the single source (E8.3); CS2 path and GSI port live in their
 * own sections (E16.2). Main revalidates regardless (ADR-022) — this
 * resolver is form UX.
 */
const settingsFormSchema = z.object({
  theme: SETTINGS_FIELD_SCHEMAS.theme,
  autostart: SETTINGS_FIELD_SCHEMAS.autostart,
  closeToTray: SETTINGS_FIELD_SCHEMAS.closeToTray,
  autoUpdate: SETTINGS_FIELD_SCHEMAS.autoUpdate,
});

type SettingsFormValues = z.infer<typeof settingsFormSchema>;

const THEME_OPTIONS: ReadonlyArray<{ value: Settings['theme']; label: string }> = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'Follow system' },
];

const TOGGLE_FIELDS: ReadonlyArray<{
  name: 'autostart' | 'closeToTray' | 'autoUpdate';
  label: string;
  description: string;
}> = [
  {
    name: 'autostart',
    label: 'Start with Windows',
    description: 'Launch TactiCS automatically when Windows starts.',
  },
  {
    name: 'closeToTray',
    label: 'Close to tray',
    description: 'Keep TactiCS running in the tray when the window is closed.',
  },
  {
    name: 'autoUpdate',
    label: 'Automatic updates',
    description: 'Check for updates and install them automatically.',
  },
];

function toFormValues(settings: Settings): SettingsFormValues {
  return {
    theme: settings.theme,
    autostart: settings.autostart,
    closeToTray: settings.closeToTray,
    autoUpdate: settings.autoUpdate,
  };
}

/**
 * The settings form (E16.1, 06-ui.md §2): theme, autostart, close-to-tray
 * and auto-update. Submit sends the four fields as a `settings.update`
 * partial; the form re-initializes from the store once
 * `evt:settings.changed` lands — no optimistic UI (ADR-033).
 */
export function SettingsForm(): JSX.Element {
  const settings = useSettingsStore((state) => state.settings);

  if (settings === undefined) {
    return <p className="text-muted-foreground">Loading settings…</p>;
  }
  return <SettingsFields settings={settings} />;
}

function SettingsFields({ settings }: { readonly settings: Settings }): JSX.Element {
  const baseId = useId();
  const [error, setError] = useState<string | undefined>(undefined);
  // Memoized so the store-fed reset fires only when the slice changes —
  // react-hook-form watches the `values` reference.
  const values = useMemo(() => toFormValues(settings), [settings]);
  const { control, handleSubmit, formState } = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    values,
  });

  async function onSubmit(data: SettingsFormValues): Promise<void> {
    setError(undefined);
    const result = await updateSettings(data);
    if (!result.ok) {
      setError(result.error.message);
    }
    // Success needs no handling: the wiring applies `evt:settings.changed`
    // to the store and `values` re-initializes the form from it.
  }

  return (
    <form
      className="flex max-w-xl flex-col gap-6"
      onSubmit={(event) => {
        void handleSubmit(onSubmit)(event);
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor={`${baseId}-theme`}>Theme</Label>
        <Controller
          control={control}
          name="theme"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id={`${baseId}-theme`} className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THEME_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>
      {TOGGLE_FIELDS.map((toggle) => (
        <div key={toggle.name} className="flex items-start justify-between gap-4">
          <div className="grid gap-1">
            <Label htmlFor={`${baseId}-${toggle.name}`}>{toggle.label}</Label>
            <p
              id={`${baseId}-${toggle.name}-description`}
              className="text-muted-foreground text-sm"
            >
              {toggle.description}
            </p>
          </div>
          <Controller
            control={control}
            name={toggle.name}
            render={({ field }) => (
              <Switch
                id={`${baseId}-${toggle.name}`}
                aria-describedby={`${baseId}-${toggle.name}-description`}
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </div>
      ))}
      {error !== undefined && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" disabled={formState.isSubmitting}>
          Save
        </Button>
      </div>
    </form>
  );
}
