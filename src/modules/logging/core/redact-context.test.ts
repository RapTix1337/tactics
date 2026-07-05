import { describe, expect, it } from 'vitest';

import { redactContext, REDACTED_VALUE } from './redact-context';

describe('redactContext', () => {
  it('redacts banned keys case-insensitively', () => {
    expect(
      redactContext({
        token: 'secret',
        authToken: 'secret',
        steamId: '7656...',
        SteamIDs: ['7656...'],
        playerName: 'nick',
        players: ['a', 'b'],
        rawPayload: { map: {} },
      }),
    ).toEqual({
      token: REDACTED_VALUE,
      authToken: REDACTED_VALUE,
      steamId: REDACTED_VALUE,
      SteamIDs: REDACTED_VALUE,
      playerName: REDACTED_VALUE,
      players: REDACTED_VALUE,
      rawPayload: REDACTED_VALUE,
    });
  });

  it('keeps legitimate keys and values untouched', () => {
    const context = {
      command: 'app.getSnapshot',
      map: { name: 'de_dust2' },
      steamPath: 'C:/Steam',
      attempts: 3,
      enabled: true,
      detail: null,
    };
    expect(redactContext(context)).toEqual(context);
  });

  it('redacts banned keys in nested objects and arrays', () => {
    expect(
      redactContext({
        request: { auth: { token: 'secret' }, path: '/gsi' },
        batch: [{ steamId: 'x' }, { ok: true }],
      }),
    ).toEqual({
      request: { auth: { token: REDACTED_VALUE }, path: '/gsi' },
      batch: [{ steamId: REDACTED_VALUE }, { ok: true }],
    });
  });

  it('does not mutate the input', () => {
    const context = { token: 'secret', nested: { steamId: 'x' } };
    redactContext(context);
    expect(context).toEqual({ token: 'secret', nested: { steamId: 'x' } });
  });

  it('passes class instances through unchanged', () => {
    const error = new Error('boom');
    const result = redactContext({ error });
    expect(result['error']).toBe(error);
  });

  it('survives circular references', () => {
    const cycle: Record<string, unknown> = { ok: true };
    cycle['self'] = cycle;
    expect(redactContext({ cycle })).toEqual({
      cycle: { ok: true, self: REDACTED_VALUE },
    });
  });
});
