import { describe, expect, it, vi } from 'vitest';

import type { Logger } from '../../shared';
import { updatesCheck, updatesInstall } from '../../shared';
import type { CommandRegistrationDeps } from './register-command';
import type { UpdatesCommandDeps } from './updates-commands';
import { registerUpdatesCommands } from './updates-commands';

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

function setup(overrides: Partial<UpdatesCommandDeps> = {}): {
  handlers: Map<string, RegisteredListener>;
  checkNow: ReturnType<typeof vi.fn>;
  quitAndInstall: ReturnType<typeof vi.fn>;
} {
  const handlers = new Map<string, RegisteredListener>();
  const deps: CommandRegistrationDeps<FakeEvent> = {
    registerHandler: (channel, listener): void => {
      handlers.set(channel, listener);
    },
    isTrustedSender: (event): boolean => event.trusted,
    logger: silentLogger,
  };
  const checkNow = vi.fn();
  const quitAndInstall = vi.fn().mockReturnValue(true);

  registerUpdatesCommands(deps, { checkNow, quitAndInstall, ...overrides });

  return { handlers, checkNow, quitAndInstall };
}

describe('registerUpdatesCommands', () => {
  it('updates.check acknowledges and hands off to the service — the result is event territory', async () => {
    const { handlers, checkNow } = setup();

    const listener = handlers.get(updatesCheck.channel);
    expect(listener).toBeDefined();
    await expect(listener?.({ trusted: true }, undefined)).resolves.toEqual({
      ok: true,
      data: undefined,
    });

    expect(checkNow).toHaveBeenCalledOnce();
  });

  it('updates.install acknowledges when a downloaded update installs', async () => {
    const { handlers, quitAndInstall } = setup();

    await expect(
      handlers.get(updatesInstall.channel)?.({ trusted: true }, undefined),
    ).resolves.toEqual({ ok: true, data: undefined });

    expect(quitAndInstall).toHaveBeenCalledOnce();
  });

  it('updates.install without a ready update is the named UPDATE_NOT_READY error', async () => {
    const { handlers } = setup({ quitAndInstall: () => false });

    await expect(
      handlers.get(updatesInstall.channel)?.({ trusted: true }, undefined),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'UPDATE_NOT_READY', message: 'No downloaded update is ready to install.' },
    });
  });
});
