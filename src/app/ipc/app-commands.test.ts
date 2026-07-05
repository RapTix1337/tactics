import { describe, expect, it, vi } from 'vitest';

import type { Logger, Settings } from '../../shared';
import { appGetSnapshot, appReportRendererError } from '../../shared';
import { registerAppCommands } from './app-commands';
import type { CommandRegistrationDeps } from './register-command';

const silentLogger: Logger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

const snapshotSettings: Settings = {
  theme: 'system',
  cs2Path: null,
  gsiPort: 42731,
  autostart: false,
  closeToTray: true,
  autoUpdate: true,
};

interface FakeEvent {
  trusted: boolean;
}

type RegisteredListener = (event: FakeEvent, request: unknown) => Promise<unknown>;

function setup(): {
  handlers: Map<string, RegisteredListener>;
  rendererError: ReturnType<typeof vi.fn>;
} {
  const handlers = new Map<string, RegisteredListener>();
  const deps: CommandRegistrationDeps<FakeEvent> = {
    registerHandler: (channel, listener): void => {
      handlers.set(channel, listener);
    },
    isTrustedSender: (event): boolean => event.trusted,
    logger: silentLogger,
  };
  const rendererError = vi.fn();

  registerAppCommands(
    deps,
    { ...silentLogger, error: rendererError },
    { getSettings: () => snapshotSettings },
  );

  return { handlers, rendererError };
}

describe('registerAppCommands', () => {
  it('registers app.getSnapshot answering with the current settings slice', async () => {
    const { handlers } = setup();

    const listener = handlers.get(appGetSnapshot.channel);
    expect(listener).toBeDefined();
    // z.void() request: the renderer invokes with undefined.
    await expect(listener?.({ trusted: true }, undefined)).resolves.toEqual({
      ok: true,
      data: { settings: snapshotSettings },
    });
  });

  it('logs a reported renderer error under the renderer scope and acknowledges', async () => {
    const { handlers, rendererError } = setup();

    const listener = handlers.get(appReportRendererError.channel);
    expect(listener).toBeDefined();
    await expect(
      listener?.(
        { trusted: true },
        { message: 'TypeError: boom', stack: 'TypeError: boom\n    at render', route: '/live' },
      ),
    ).resolves.toEqual({ ok: true, data: undefined });

    expect(rendererError).toHaveBeenCalledWith('TypeError: boom', {
      stack: 'TypeError: boom\n    at render',
      route: '/live',
    });
  });

  it('omits absent optional report fields from the log context', async () => {
    const { handlers, rendererError } = setup();

    await handlers.get(appReportRendererError.channel)?.({ trusted: true }, { message: 'boom' });

    expect(rendererError).toHaveBeenCalledWith('boom', {});
  });
});
