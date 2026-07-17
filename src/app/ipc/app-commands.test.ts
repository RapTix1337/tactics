import { describe, expect, it, vi } from 'vitest';

import type {
  GameState,
  Logger,
  OverlayState,
  ScoreboardState,
  Settings,
  UpdateState,
} from '../../shared';
import { appGetSnapshot, appOpenExternal, appReportRendererError } from '../../shared';
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
  scoreboardEnabled: true,
  scoreboardLayout: { groups: [{ label: 'Match totals', fields: ['kills'] }] },
  gsiTiming: 'default',
  overlayScoreboardOpacity: 1,
  overlayMapOpacity: 1,
  overlayCalloutOpacity: 1,
  overlayChromeOpacity: 1,
};

const snapshotGameState: GameState = {
  status: 'connected',
  map: { kind: 'resolved', mapId: 'de_dust2' },
};

const snapshotUpdateState: UpdateState = {
  status: 'ready',
  version: '1.2.3',
  errorKind: null,
};

const snapshotScoreboard: ScoreboardState = { active: false };

const snapshotOverlay: OverlayState = { open: true };

interface FakeEvent {
  trusted: boolean;
}

type RegisteredListener = (event: FakeEvent, request: unknown) => Promise<unknown>;

function setup(): {
  handlers: Map<string, RegisteredListener>;
  rendererError: ReturnType<typeof vi.fn>;
  openExternal: ReturnType<typeof vi.fn>;
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
  const openExternal = vi.fn().mockResolvedValue(undefined);

  registerAppCommands(
    deps,
    { ...silentLogger, error: rendererError },
    {
      getGameState: () => snapshotGameState,
      getOverlayState: () => snapshotOverlay,
      getScoreboardState: () => snapshotScoreboard,
      getSettings: () => snapshotSettings,
      getUpdateState: () => snapshotUpdateState,
    },
    { openExternal },
  );

  return { handlers, rendererError, openExternal };
}

describe('registerAppCommands', () => {
  it('registers app.getSnapshot answering with the current mirror slices', async () => {
    const { handlers } = setup();

    const listener = handlers.get(appGetSnapshot.channel);
    expect(listener).toBeDefined();
    // z.void() request: the renderer invokes with undefined.
    await expect(listener?.({ trusted: true }, undefined)).resolves.toEqual({
      ok: true,
      data: {
        gameState: snapshotGameState,
        overlay: snapshotOverlay,
        scoreboard: snapshotScoreboard,
        settings: snapshotSettings,
        updateState: snapshotUpdateState,
      },
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

  it('opens an allowlisted URL in the default browser (app.openExternal)', async () => {
    const { handlers, openExternal } = setup();

    const listener = handlers.get(appOpenExternal.channel);
    expect(listener).toBeDefined();
    await expect(
      listener?.({ trusted: true }, { url: 'https://github.com/RapTix1337/tactics' }),
    ).resolves.toEqual({ ok: true, data: undefined });

    expect(openExternal).toHaveBeenCalledWith('https://github.com/RapTix1337/tactics');
  });

  it('rejects a non-allowlisted URL at the boundary without touching the shell', async () => {
    const { handlers, openExternal } = setup();

    await expect(
      handlers.get(appOpenExternal.channel)?.({ trusted: true }, { url: 'https://example.com' }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'Invalid request for app.openExternal.' },
    });

    expect(openExternal).not.toHaveBeenCalled();
  });

  it('answers INTERNAL when the OS handoff rejects', async () => {
    const { handlers, openExternal } = setup();
    openExternal.mockRejectedValue(new Error('no browser registered'));

    await expect(
      handlers.get(appOpenExternal.channel)?.(
        { trusted: true },
        { url: 'https://readtldr.gg/simpleradar' },
      ),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'Could not open the link in the default browser.' },
    });
  });
});
