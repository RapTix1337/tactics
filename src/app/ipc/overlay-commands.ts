import type { OverlayResizeEdge, OverlayState } from '../../shared';
import { overlayChanged, overlayClose, overlayOpen, overlayResize, success } from '../../shared';
import type { EventPublisher } from './event-publisher';
import type { CommandRegistrationDeps } from './register-command';
import { registerCommand } from './register-command';

/**
 * Dependencies of the overlay commands (OVL.5) as narrow structural
 * interfaces (the E5.2 pattern): the overlay window manager's entry points
 * plus the central event publisher. The composition root passes the manager
 * created in app-lifecycle.ts and the all-windows publisher.
 */
export interface OverlayCommandDeps {
  /** Idempotent: an existing overlay is focused, never duplicated. */
  readonly open: () => void;
  /** Idempotent: a no-op without a window. */
  readonly close: () => void;
  /** No-op after close — an in-flight drag frame racing a close is normal. */
  readonly resize: (edge: OverlayResizeEdge, pointerX: number, pointerY: number) => void;
  /** The manager's state feed; both close paths converge on one change. */
  readonly onStateChanged: (listener: (state: OverlayState) => void) => () => void;
  readonly publisher: EventPublisher;
}

/**
 * The overlay's IPC surface (live-overlay 02-design.md §2.2/§3, ADR-058):
 * `overlay.open`/`close`/`resize` dispatch thinly onto the manager, and the
 * manager's state changes are published as `evt:overlay.changed` — stores are
 * fed by the event, the command responses exist for the caller's error
 * handling (ADR-033). The subscription lives here (not in the composition
 * root) so the whole surface — commands in, event out — is tested as one
 * unit (maintainer decision, OVL.5).
 */
export function registerOverlayCommands<TEvent>(
  deps: CommandRegistrationDeps<TEvent>,
  overlay: OverlayCommandDeps,
): void {
  registerCommand(deps, overlayOpen, () => {
    overlay.open();
    // open() returns with the window existing (or focused), so the slice is
    // literal; the authoritative state still arrives via the event.
    return success({ open: true });
  });

  registerCommand(deps, overlayClose, () => {
    overlay.close();
    return success({ open: false });
  });

  registerCommand(deps, overlayResize, ({ edge, pointerX, pointerY }) => {
    overlay.resize(edge, pointerX, pointerY);
    return success(undefined);
  });

  overlay.onStateChanged((state) => {
    overlay.publisher.publish(overlayChanged, state);
  });
}
