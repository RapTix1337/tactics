import type { JSX } from 'react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { installUpdate } from '@/lib/ipc/updates';
import { useUpdateStore } from '@/stores/update-store';

/**
 * The sidebar's unobtrusive update indicator (E18.2, REL-02): invisible
 * until an update is ready — `ready` is sticky (E18.1), so once shown it
 * never flickers away — then a one-line notice plus the "Restart & install"
 * action (`updates.install`). Everything else about updates lives in the
 * settings section; "users see and control updates without being nagged".
 */
export function UpdateIndicator(): JSX.Element | null {
  const updateState = useUpdateStore((state) => state.updateState);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  if (updateState?.status !== 'ready') {
    return null;
  }

  async function handleInstall(): Promise<void> {
    setPending(true);
    setError(undefined);
    const result = await installUpdate();
    setPending(false);
    if (!result.ok) {
      setError(result.error.message);
    }
    // Success needs no handling: the app quits and installs.
  }

  return (
    <div className="flex flex-col gap-1.5 px-2 pb-1.5">
      <p role="status" className="text-sm">
        {updateState.version === null ? 'Update ready.' : `Update ${updateState.version} ready.`}
      </p>
      {error !== undefined && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        disabled={pending}
        onClick={() => {
          void handleInstall();
        }}
      >
        Restart &amp; install
      </Button>
    </div>
  );
}
