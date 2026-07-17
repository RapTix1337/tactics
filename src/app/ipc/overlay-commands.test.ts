import { describe, expect, it, vi } from 'vitest';

import type { Logger, OverlayState } from '../../shared';
import { overlayChanged, overlayClose, overlayOpen, overlayResize } from '../../shared';
import type { EventPublisher } from './event-publisher';
import { registerOverlayCommands } from './overlay-commands';
import type { CommandRegistrationDeps } from './register-command';

const silentLogger: Logger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

interface FakeEvent {
  trusted: boolean;
}

type RegisteredListener = (event: FakeEvent, request: unknown) => Promise<unknown>;

function setup(): {
  invoke: (channel: string, request: unknown) => Promise<unknown>;
  manager: {
    open: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
  };
  stateListeners: ((state: OverlayState) => void)[];
  published: unknown[];
} {
  const handlers = new Map<string, RegisteredListener>();
  const deps: CommandRegistrationDeps<FakeEvent> = {
    registerHandler: (channel, listener): void => {
      handlers.set(channel, listener);
    },
    isTrustedSender: (event): boolean => event.trusted,
    logger: silentLogger,
  };

  const manager = { open: vi.fn(), close: vi.fn(), resize: vi.fn() };
  const stateListeners: ((state: OverlayState) => void)[] = [];
  const published: unknown[] = [];
  const publisher: EventPublisher = {
    publish: (definition, payload): void => {
      published.push({ channel: definition.channel, payload });
    },
  };

  registerOverlayCommands(deps, {
    ...manager,
    onStateChanged: (listener) => {
      stateListeners.push(listener);
      return () => undefined;
    },
    publisher,
  });

  return {
    invoke: (channel, request): Promise<unknown> => {
      const listener = handlers.get(channel);
      if (listener === undefined) {
        throw new Error(`${channel} was not registered`);
      }
      return listener({ trusted: true }, request);
    },
    manager,
    stateListeners,
    published,
  };
}

describe('registerOverlayCommands', () => {
  it('dispatches overlay.open to the manager and responds with the full slice', async () => {
    const { invoke, manager } = setup();

    // z.void() request: the renderer invokes with undefined.
    await expect(invoke(overlayOpen.channel, undefined)).resolves.toEqual({
      ok: true,
      data: { open: true },
    });

    expect(manager.open).toHaveBeenCalledOnce();
  });

  it('answers open while open as a regular success (idempotency lives in the manager)', async () => {
    const { invoke, manager } = setup();

    await invoke(overlayOpen.channel, undefined);
    await expect(invoke(overlayOpen.channel, undefined)).resolves.toEqual({
      ok: true,
      data: { open: true },
    });

    expect(manager.open).toHaveBeenCalledTimes(2);
  });

  it('dispatches overlay.close and responds with the closed slice — also while closed', async () => {
    const { invoke, manager } = setup();

    await expect(invoke(overlayClose.channel, undefined)).resolves.toEqual({
      ok: true,
      data: { open: false },
    });
    await expect(invoke(overlayClose.channel, undefined)).resolves.toEqual({
      ok: true,
      data: { open: false },
    });

    expect(manager.close).toHaveBeenCalledTimes(2);
  });

  it('passes the resize edge and screen coordinates through and only acknowledges', async () => {
    const { invoke, manager } = setup();

    await expect(
      invoke(overlayResize.channel, { edge: 'bottom-right', pointerX: 1720.5, pointerY: 980 }),
    ).resolves.toEqual({ ok: true, data: undefined });

    expect(manager.resize).toHaveBeenCalledExactlyOnceWith('bottom-right', 1720.5, 980);
  });

  it('acknowledges a resize racing the close (the manager no-ops after close)', async () => {
    const { invoke } = setup();

    await invoke(overlayClose.channel, undefined);
    await expect(
      invoke(overlayResize.channel, { edge: 'left', pointerX: 10, pointerY: 20 }),
    ).resolves.toEqual({ ok: true, data: undefined });
  });

  it('rejects an unknown edge at the boundary without touching the manager', async () => {
    const { invoke, manager } = setup();

    await expect(
      invoke(overlayResize.channel, { edge: 'center', pointerX: 10, pointerY: 20 }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'Invalid request for overlay.resize.' },
    });

    expect(manager.resize).not.toHaveBeenCalled();
  });

  it('subscribes exactly once and publishes every state change as the full slice', () => {
    const { stateListeners, published } = setup();

    expect(stateListeners).toHaveLength(1);
    stateListeners[0]?.({ open: true });
    stateListeners[0]?.({ open: false });

    expect(published).toEqual([
      { channel: overlayChanged.channel, payload: { open: true } },
      { channel: overlayChanged.channel, payload: { open: false } },
    ]);
  });
});
