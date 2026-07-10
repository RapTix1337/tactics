import { zodResolver } from '@hookform/resolvers/zod';
import type { JSX } from 'react';
import { useId, useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { SETTINGS_FIELD_SCHEMAS } from '../../../shared/settings';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { updateSettings } from '../../lib/ipc/settings';
import { useSettingsStore } from '../../stores/settings-store';
import { useGsiSetupPlan } from './use-gsi-setup-plan';

/** The shared field schema minus its automatic marker — the manual input
 * must be a real port, `null` is expressed by the switch instead. */
const portNumberSchema = SETTINGS_FIELD_SCHEMAS.gsiPort.unwrap();

/**
 * The form keeps the port as the raw input string and validates it only in
 * manual mode; the submit converts to the contract's `number | null`. Main
 * revalidates regardless (ADR-022) — this resolver is form UX.
 */
const gsiPortFormSchema = z
  .object({ manual: z.boolean(), port: z.string() })
  .superRefine((value, ctx) => {
    if (!value.manual) {
      return;
    }
    const trimmed = value.port.trim();
    const parsed = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
    if (!portNumberSchema.safeParse(parsed).success) {
      ctx.addIssue({
        code: 'custom',
        path: ['port'],
        message: 'Enter a port between 1 and 65535.',
      });
    }
  });

type GsiPortFormValues = z.infer<typeof gsiPortFormSchema>;

/**
 * The advanced GSI port section of the settings page (E16.2,
 * 01-requirements.md §9): automatic by default — showing the effective port
 * from `gsi.getSetupPlan` — with a manual fix via `settings.update`. Main
 * owns the consequence (server rebind + config re-verify, E10.7); the form
 * re-initializes from the store once `evt:settings.changed` lands — no
 * optimistic UI (ADR-033).
 */
export function GsiPortSection(): JSX.Element {
  const gsiPort = useSettingsStore((state) => state.settings?.gsiPort);
  const settingsLoaded = useSettingsStore((state) => state.settings !== undefined);

  if (!settingsLoaded) {
    return (
      <section className="flex max-w-xl flex-col gap-3">
        <h2 className="text-lg font-medium">GSI port</h2>
        <p className="text-muted-foreground">Loading settings…</p>
      </section>
    );
  }
  return <GsiPortFields gsiPort={gsiPort ?? null} />;
}

function GsiPortFields({ gsiPort }: { readonly gsiPort: number | null }): JSX.Element {
  const baseId = useId();
  const { plan } = useGsiSetupPlan();
  const [error, setError] = useState<string | undefined>(undefined);
  // Memoized so the store-fed reset fires only when the slice changes —
  // react-hook-form watches the `values` reference.
  const values = useMemo<GsiPortFormValues>(
    () => ({ manual: gsiPort !== null, port: gsiPort !== null ? String(gsiPort) : '' }),
    [gsiPort],
  );
  const { control, handleSubmit, formState } = useForm<GsiPortFormValues>({
    resolver: zodResolver(gsiPortFormSchema),
    values,
  });
  // `useWatch` instead of `watch()` — the React Compiler cannot memoize the
  // latter safely (react-hooks/incompatible-library).
  const manual = useWatch({ control, name: 'manual' });

  async function onSubmit(data: GsiPortFormValues): Promise<void> {
    setError(undefined);
    const result = await updateSettings({
      gsiPort: data.manual ? Number(data.port.trim()) : null,
    });
    if (!result.ok) {
      setError(result.error.message);
    }
    // Success needs no handling: the wiring applies `evt:settings.changed`
    // to the store and `values` re-initializes the form from it.
  }

  // The effective port is only knowable from a ready plan; with CS2 missing
  // the section still works, just without the number (maintainer decision).
  const automaticDescription =
    plan.phase === 'ready'
      ? `Automatic — currently using port ${String(plan.plan.port)}.`
      : 'Automatic port selection.';

  return (
    <section className="flex max-w-xl flex-col gap-3">
      <h2 className="text-lg font-medium">GSI port</h2>
      <p className="text-muted-foreground text-sm">
        Advanced: the local port CS2 reports game state to. Changing it makes an already written GSI
        config outdated — repair the config and restart CS2 afterwards.
      </p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          void handleSubmit(onSubmit)(event);
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-1">
            <Label htmlFor={`${baseId}-manual`}>Set port manually</Label>
            <p id={`${baseId}-manual-description`} className="text-muted-foreground text-sm">
              {automaticDescription}
            </p>
          </div>
          <Controller
            control={control}
            name="manual"
            render={({ field }) => (
              <Switch
                id={`${baseId}-manual`}
                aria-describedby={`${baseId}-manual-description`}
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </div>
        {manual && (
          <div className="grid gap-2">
            <Label htmlFor={`${baseId}-port`}>Port</Label>
            <Controller
              control={control}
              name="port"
              render={({ field }) => (
                <Input
                  id={`${baseId}-port`}
                  type="text"
                  inputMode="numeric"
                  className="w-32"
                  aria-invalid={formState.errors.port !== undefined}
                  aria-describedby={
                    formState.errors.port !== undefined ? `${baseId}-port-error` : undefined
                  }
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
            {formState.errors.port !== undefined && (
              <p id={`${baseId}-port-error`} className="text-destructive text-sm">
                {formState.errors.port.message}
              </p>
            )}
          </div>
        )}
        {error !== undefined && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <div>
          <Button type="submit" disabled={formState.isSubmitting}>
            Save port
          </Button>
        </div>
      </form>
    </section>
  );
}
