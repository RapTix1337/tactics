import type { AnyEventDefinition, EventPayload } from '../../shared';

/**
 * Central event publisher (ADR-022, 03-technical-design.md §5.4): every
 * state event reaches all app windows through this single door, on the
 * channel derived by the contract definition. Targets are injected as a
 * `webContents`-shaped structural interface for testability; the
 * BrowserWindow-backed provider lives in electron-ipc.ts.
 */
export interface PublishTarget {
  isDestroyed(): boolean;
  send(channel: string, payload: unknown): void;
}

export interface EventPublisher {
  publish<TDefinition extends AnyEventDefinition>(
    definition: TDefinition,
    payload: EventPayload<TDefinition>,
  ): void;
}

export function createEventPublisher(getTargets: () => readonly PublishTarget[]): EventPublisher {
  return {
    publish(definition, payload): void {
      // Targets are read per publish, so windows recreated later (tray
      // reopen, E17.1) are covered without re-wiring.
      for (const target of getTargets()) {
        if (!target.isDestroyed()) {
          target.send(definition.channel, payload);
        }
      }
    },
  };
}
