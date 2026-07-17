import type { JSX } from 'react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import type { ReadyGsiSetupPlan } from '@/lib/ipc/gsi-setup';
import { pickCs2Path } from '@/lib/ipc/gsi-setup';

import type { CommandError } from '../../../shared/envelope';
import { useGsiSetupPlan } from './use-gsi-setup-plan';

const SOURCE_LABELS: Record<ReadyGsiSetupPlan['source'], string> = {
  detected: 'Detected automatically',
  manual: 'Set manually',
};

/** The named pick errors, worded for the section (the E15.2 wording). */
function describePickError(error: CommandError): string {
  if (error.code === 'INVALID_PATH') {
    return 'The selected folder does not look like a CS2 installation.';
  }
  return error.message;
}

export interface Cs2PathSectionProps {
  /** Opens the E15.2 dialog in repair mode — owned by the page, the dialog
   * belongs to the `gsi-status` feature (03-technical-design.md §3.1). */
  readonly onRepair: () => void;
}

/**
 * The CS2 path section of the settings page (E16.2, 01-requirements.md §9):
 * shows the effective CS2 path with its source (from `gsi.getSetupPlan`),
 * offers the manual pick (`steam.pickCs2Path`, GSI-02) and the GSI config
 * repair. A successful pick lands via `evt:settings.changed` (ADR-033) — the
 * plan hook re-fetches from the changed slice, nothing is mirrored here.
 */
export function Cs2PathSection({ onRepair }: Cs2PathSectionProps): JSX.Element {
  const { plan, refetch } = useGsiSetupPlan();
  const [pending, setPending] = useState(false);
  const [pickError, setPickError] = useState<string | undefined>(undefined);

  async function handlePick(): Promise<void> {
    setPending(true);
    setPickError(undefined);
    const result = await pickCs2Path();
    setPending(false);
    if (!result.ok) {
      setPickError(describePickError(result.error));
    }
    // Selected needs no handling: main persists and publishes
    // `evt:settings.changed`; the plan hook re-fetches from the new slice.
  }

  return (
    <section className="flex max-w-xl flex-col gap-3">
      <h2 className="text-lg font-medium">CS2 path</h2>

      {plan.phase === 'loading' && (
        <p className="text-muted-foreground text-sm">Detecting CS2 installation…</p>
      )}

      {plan.phase === 'ready' && (
        <div className="grid gap-1">
          <p className="break-all text-sm">{plan.plan.gameRoot}</p>
          <p className="text-muted-foreground text-sm">{SOURCE_LABELS[plan.plan.source]}</p>
        </div>
      )}

      {plan.phase === 'not-found' && (
        <p className="text-sm">
          No CS2 installation was found. Select your CS2 folder manually below.
        </p>
      )}

      {plan.phase === 'error' && (
        <div className="flex flex-col gap-2">
          <p className="text-destructive text-sm">{plan.message}</p>
          <div>
            <Button type="button" variant="outline" onClick={refetch}>
              Try again
            </Button>
          </div>
        </div>
      )}

      {pickError !== undefined && (
        <p role="alert" className="text-destructive text-sm">
          {pickError}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            void handlePick();
          }}
        >
          Select CS2 folder…
        </Button>
        <Button type="button" variant="outline" onClick={onRepair}>
          Repair GSI config…
        </Button>
      </div>
    </section>
  );
}
