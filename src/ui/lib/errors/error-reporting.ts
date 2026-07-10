import type { TacticsBridge } from '../../../shared/bridge';
import type { ContractCommandDefinitions } from '../../../shared/commands';
import type { CommandRequest } from '../../../shared/contract';

type RendererErrorReport = CommandRequest<ContractCommandDefinitions['app.reportRendererError']>;

/**
 * After this many reports one final suppression notice is sent, then the
 * reporter goes quiet — an error loop (e.g., in a rAF callback) must not
 * flood the main log over IPC. A window reload resets the budget.
 */
export const MAX_REPORTS_PER_RENDERER_SESSION = 50;

// The renderer truncates before sending; the contract schema's caps
// (commands.ts) stay above these on purpose, as the boundary guard.
const MESSAGE_LIMIT = 1_000;
const STACK_LIMIT = 8_000;
// The route cap equals the schema cap: routes are short app paths, an
// overrun would only ever come from a runaway `$mapId` param.
const ROUTE_LIMIT = 500;

/**
 * Reports one escalated renderer error to main (§8.3). `candidate` is the
 * thrown value; `fallbackMessage` describes the error when the candidate is
 * not an `Error` (e.g., `ErrorEvent.message`, or a rendered rejection
 * reason).
 */
export type ErrorReporter = (candidate: unknown, fallbackMessage: string) => void;

/**
 * The renderer's single escalation path to `app.reportRendererError` —
 * the global handlers below and the route error boundary (E13.3) share one
 * reporter instance, so an error reaching both is deduplicated by object
 * identity (WeakSet: no retention). Reporting failures never throw: a
 * throwing 'error' listener would fire the error event again. `getRoute`
 * resolves the current route lazily per report — the router is created
 * after the reporter (main.tsx), and it must not break a report when it
 * throws or is still absent.
 */
export function createErrorReporter(
  bridge: TacticsBridge | undefined,
  getRoute?: () => string | undefined,
): ErrorReporter {
  const reported = new WeakSet<object>();
  let sent = 0;
  let suppressionAnnounced = false;

  return (candidate, fallbackMessage): void => {
    try {
      if (bridge === undefined) {
        return;
      }
      if (typeof candidate === 'object' && candidate !== null) {
        if (reported.has(candidate)) {
          return;
        }
        reported.add(candidate);
      }
      if (sent >= MAX_REPORTS_PER_RENDERER_SESSION) {
        if (!suppressionAnnounced) {
          suppressionAnnounced = true;
          send(bridge, {
            message: `Further renderer error reports suppressed after ${String(MAX_REPORTS_PER_RENDERER_SESSION)}`,
          });
        }
        return;
      }
      sent += 1;
      send(bridge, {
        ...describeCandidate(candidate, fallbackMessage),
        ...describeRoute(getRoute),
      });
    } catch (cause) {
      console.error('Renderer error reporting failed', cause);
    }
  };
}

/**
 * Wires `error` and `unhandledrejection` to the reporter. The target is a
 * structural slice of `window` so tests drive the listeners directly
 * (jsdom cannot construct PromiseRejectionEvent).
 */
export interface GlobalErrorTarget {
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  addEventListener(
    type: 'unhandledrejection',
    listener: (event: PromiseRejectionEvent) => void,
  ): void;
}

export function installGlobalErrorHandlers(target: GlobalErrorTarget, report: ErrorReporter): void {
  target.addEventListener('error', (event) => {
    // event.error is null/undefined for opaque errors — event.message
    // still carries the browser's description.
    report(event.error, event.message);
  });
  target.addEventListener('unhandledrejection', (event) => {
    report(event.reason, `Unhandled promise rejection: ${safeString(event.reason)}`);
  });
}

function describeRoute(
  getRoute: (() => string | undefined) | undefined,
): Pick<RendererErrorReport, 'route'> {
  try {
    const route = getRoute?.();
    return route === undefined ? {} : { route: truncate(route, ROUTE_LIMIT) };
  } catch {
    return {};
  }
}

function describeCandidate(candidate: unknown, fallbackMessage: string): RendererErrorReport {
  if (candidate instanceof Error) {
    return {
      message: truncate(`${candidate.name}: ${candidate.message}`, MESSAGE_LIMIT),
      ...(candidate.stack === undefined ? {} : { stack: truncate(candidate.stack, STACK_LIMIT) }),
    };
  }
  return { message: truncate(fallbackMessage, MESSAGE_LIMIT) };
}

function send(bridge: TacticsBridge, report: RendererErrorReport): void {
  bridge.invoke('app.reportRendererError', report).then(
    (result) => {
      if (!result.ok) {
        // Last resort: the report was refused, so only the console remains.
        console.error(`Renderer error report rejected: ${result.error.message}`);
      }
    },
    (cause: unknown) => {
      console.error('Renderer error report failed', cause);
    },
  );
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return '<unstringifiable value>';
  }
}
