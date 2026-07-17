import type { JSX } from 'react';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import type { ErrorReporter } from '@/lib/errors/error-reporting';

interface RouteErrorFallbackProps {
  readonly error: Error;
  readonly report: ErrorReporter;
}

/**
 * Fallback UI of the route error boundaries (E13.3, 03-technical-design.md
 * §8.3): the router catches a thrown render/loader error per route match,
 * this component shows the failure and escalates it once via the shared
 * reporter (WeakSet dedupe absorbs StrictMode's double effect). Reload
 * restarts the renderer — the recovery path that resets all UI state.
 */
export function RouteErrorFallback({ error, report }: RouteErrorFallbackProps): JSX.Element {
  useEffect(() => {
    report(error, 'Unhandled route error');
  }, [error, report]);

  return (
    <div role="alert" className="flex min-h-full flex-col items-center justify-center gap-3 p-4">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground max-w-prose text-center">
        This view crashed. The error was written to the log — reloading usually recovers.
      </p>
      <Button onClick={() => window.location.reload()}>Reload app</Button>
    </div>
  );
}
