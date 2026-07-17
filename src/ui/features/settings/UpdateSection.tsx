import type { JSX } from 'react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { checkForUpdates, installUpdate } from '@/lib/ipc/updates';
import { useSettingsStore } from '@/stores/settings-store';
import { useUpdateStore } from '@/stores/update-store';

import { APP_NAME } from '../../../shared/constants';
import type { CommandResult } from '../../../shared/envelope';
import type { UpdateErrorKind, UpdateState } from '../../../shared/update-state';

/** The named failure classes (E18.1), worded for the section. */
const ERROR_DESCRIPTIONS: Record<UpdateErrorKind, string> = {
  offline: 'The update check failed: you appear to be offline.',
  'rate-limited': 'The update check failed: too many requests — try again later.',
  unknown: 'The update check failed. Details are in the log.',
};

function describeState(state: UpdateState): string {
  const version = state.version === null ? 'An update' : `Update ${state.version}`;
  switch (state.status) {
    case 'idle':
      return 'No update available.';
    case 'checking':
      return 'Checking for updates…';
    case 'available':
      return `${version} is available.`;
    case 'downloading':
      return `Downloading ${state.version === null ? 'an update' : `update ${state.version}`}…`;
    case 'ready':
      return `${version} is ready. It installs when you quit ${APP_NAME} — or restart now.`;
    case 'error':
      return ERROR_DESCRIPTIONS[state.errorKind ?? 'unknown'];
  }
}

/**
 * The updates section of the settings page (E18.2, REL-02): shows the update
 * state from `useUpdateStore`, offers the manual check, and "Restart &
 * install" once an update is ready (`updates.install`). The check is
 * disabled while automatic updates are off — PRV-02 reads strictly, the
 * module would refuse the call, so the UI disables the affordance instead
 * (E18.1 maintainer decision) — and outside the resting states (idle/error),
 * where the module never starts a check. Results arrive as
 * `evt:update.changed` via the wiring (ADR-033); nothing is mirrored here.
 */
export function UpdateSection(): JSX.Element {
  const updateState = useUpdateStore((state) => state.updateState);
  const autoUpdate = useSettingsStore((state) => state.settings?.autoUpdate);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function runCommand(command: () => Promise<CommandResult<void>>): Promise<void> {
    setPending(true);
    setError(undefined);
    const result = await command();
    setPending(false);
    if (!result.ok) {
      setError(result.error.message);
    }
    // Success needs no handling: a check's result arrives as
    // `evt:update.changed`, a successful install quits the app.
  }

  const resting = updateState?.status === 'idle' || updateState?.status === 'error';
  const checkDisabled = pending || autoUpdate !== true || !resting;

  return (
    <section className="flex max-w-xl flex-col gap-3">
      <h2 className="text-lg font-medium">Updates</h2>

      {updateState === undefined ? (
        <p className="text-muted-foreground text-sm">Loading update status…</p>
      ) : (
        <p role="status" className="text-sm">
          {describeState(updateState)}
        </p>
      )}

      {autoUpdate === false && (
        <p className="text-muted-foreground text-sm">
          Automatic updates are disabled — no update checks are made. Enable them above to check for
          updates.
        </p>
      )}

      {error !== undefined && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={checkDisabled}
          onClick={() => {
            void runCommand(checkForUpdates);
          }}
        >
          Check for updates
        </Button>
        {updateState?.status === 'ready' && (
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              void runCommand(installUpdate);
            }}
          >
            Restart &amp; install
          </Button>
        )}
      </div>
    </section>
  );
}
