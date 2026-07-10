import type { JSX } from 'react';
import { useEffect, useState } from 'react';

import type { CommandError } from '../../../shared/envelope';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import type { ReadyGsiSetupPlan } from '../../lib/ipc/gsi-setup';
import { applyGsiSetup, loadGsiSetupPlan, pickCs2Path } from '../../lib/ipc/gsi-setup';

type PlanState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly plan: ReadyGsiSetupPlan }
  | { readonly phase: 'not-found' }
  | { readonly phase: 'error'; readonly message: string };

/** A settled plan fetch, tagged with the request it answered — "loading" is
 * derived from the tag mismatch instead of set imperatively. */
interface ResolvedPlan {
  readonly request: number;
  readonly state: Exclude<PlanState, { readonly phase: 'loading' }>;
}

function toPlanState(result: Awaited<ReturnType<typeof loadGsiSetupPlan>>): ResolvedPlan['state'] {
  if (!result.ok) {
    return { phase: 'error', message: describeError(result.error) };
  }
  if (result.data.status === 'ready') {
    return { phase: 'ready', plan: result.data };
  }
  return { phase: 'not-found' };
}

export interface GsiSetupDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Same dialog, same effect (GSI-06) — the mode only words the texts. */
  readonly mode: 'setup' | 'repair';
}

/** The named IPC errors, worded for the dialog (ADR-025: user-presentable). */
function describeError(error: CommandError): string {
  switch (error.code) {
    case 'CS2_NOT_FOUND':
      return 'CS2 could not be found anymore — close and reopen this dialog to retry.';
    case 'CFG_DIR_NOT_WRITABLE':
      return 'The CS2 config folder is not writable. Check its permissions and try again.';
    case 'INVALID_PATH':
      return 'The selected folder does not look like a CS2 installation.';
    default:
      return error.message;
  }
}

const SOURCE_LABELS: Record<ReadyGsiSetupPlan['source'], string> = {
  detected: 'Detected automatically',
  manual: 'Set manually in settings',
};

/**
 * The MVP-02 setup/repair dialog (06-ui.md §2): previews the
 * `gsi.getSetupPlan` result, and the single confirmation click triggers
 * `gsi.applySetup` — the contract's only write path (structural consent,
 * ADR-032). `cs2-not-found` offers the manual folder pick (GSI-02); the
 * static "restart CS2" note is always visible (GSI-04, ADR-042 — no process
 * detection). Radix Dialog provides the focus trap and focus order (UI-06).
 */
export function GsiSetupDialog({ open, onOpenChange, mode }: GsiSetupDialogProps): JSX.Element {
  // Bumped on close and on re-fetch triggers (retry, successful manual
  // pick); a resolved answer tagged with an older request reads as loading.
  const [planRequest, setPlanRequest] = useState(0);
  const [resolved, setResolved] = useState<ResolvedPlan | undefined>(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);

  const planState: PlanState =
    resolved !== undefined && resolved.request === planRequest
      ? resolved.state
      : { phase: 'loading' };

  useEffect(() => {
    if (!open) {
      return;
    }
    // The cleanup also cancels superseded fetches: a planRequest bump
    // re-runs the effect, so an older in-flight answer never lands.
    let alive = true;
    void loadGsiSetupPlan().then((result) => {
      if (alive) {
        setResolved({ request: planRequest, state: toPlanState(result) });
      }
    });
    return (): void => {
      alive = false;
    };
  }, [open, planRequest]);

  function handleOpenChange(next: boolean): void {
    if (!next) {
      // Reset for the next open: a re-open fetches a fresh plan (the port
      // or the detected path may have changed in between).
      setPlanRequest((request) => request + 1);
      setActionError(undefined);
    }
    onOpenChange(next);
  }

  async function handleConfirm(): Promise<void> {
    setPending(true);
    setActionError(undefined);
    const result = await applyGsiSetup();
    setPending(false);
    if (result.ok) {
      handleOpenChange(false);
    } else {
      setActionError(describeError(result.error));
    }
  }

  async function handlePick(): Promise<void> {
    setPending(true);
    setActionError(undefined);
    const result = await pickCs2Path();
    setPending(false);
    if (!result.ok) {
      setActionError(describeError(result.error));
    } else if (result.data.status === 'selected') {
      setPlanRequest((request) => request + 1);
    }
  }

  const isRepair = mode === 'repair';
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isRepair ? 'Repair GSI configuration' : 'Set up Game State Integration'}
          </DialogTitle>
          <DialogDescription>
            TactiCS writes a Game State Integration config file into your CS2 folder so the game
            reports the current map. Nothing is written without your confirmation.
          </DialogDescription>
        </DialogHeader>

        {planState.phase === 'loading' && (
          <p className="text-sm text-muted-foreground">Loading setup plan…</p>
        )}

        {planState.phase === 'error' && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-destructive">{planState.message}</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPlanRequest((request) => request + 1);
              }}
            >
              Try again
            </Button>
          </div>
        )}

        {planState.phase === 'not-found' && (
          <div className="flex flex-col gap-2">
            <p className="text-sm">
              No CS2 installation was found. Select your CS2 folder manually to continue.
            </p>
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
          </div>
        )}

        {planState.phase === 'ready' && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="font-medium">CS2 folder</dt>
            <dd className="break-all text-muted-foreground">{planState.plan.gameRoot}</dd>
            <dt className="font-medium">Source</dt>
            <dd className="text-muted-foreground">{SOURCE_LABELS[planState.plan.source]}</dd>
            <dt className="font-medium">Config file</dt>
            <dd className="break-all text-muted-foreground">{planState.plan.configPath}</dd>
            <dt className="font-medium">Port</dt>
            <dd className="text-muted-foreground">{planState.plan.port}</dd>
          </dl>
        )}

        <p className="text-sm text-muted-foreground">
          CS2 loads Game State Integration configs only at game start — if CS2 is running right now,
          restart it afterwards.
        </p>

        {actionError !== undefined && <p className="text-sm text-destructive">{actionError}</p>}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          {planState.phase === 'ready' && (
            <Button
              type="button"
              disabled={pending}
              onClick={() => {
                void handleConfirm();
              }}
            >
              {isRepair ? 'Repair config file' : 'Write config file'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
