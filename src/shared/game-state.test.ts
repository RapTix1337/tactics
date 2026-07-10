import { describe, expect, it } from 'vitest';

import { gameStateSchema } from './game-state';

describe('gameStateSchema', () => {
  it('accepts every status with a map of each kind', () => {
    expect(
      gameStateSchema.safeParse({
        status: 'connected',
        map: { kind: 'resolved', mapId: 'de_dust2' },
      }).success,
    ).toBe(true);
    expect(
      gameStateSchema.safeParse({
        status: 'connected',
        map: { kind: 'unsupported', rawName: 'de_community_map' },
      }).success,
    ).toBe(true);
    expect(gameStateSchema.safeParse({ status: 'waiting', map: { kind: 'none' } }).success).toBe(
      true,
    );
  });

  it('rejects unknown statuses and malformed map variants', () => {
    expect(gameStateSchema.safeParse({ status: 'online', map: { kind: 'none' } }).success).toBe(
      false,
    );
    expect(
      gameStateSchema.safeParse({ status: 'connected', map: { kind: 'resolved' } }).success,
    ).toBe(false);
    expect(
      gameStateSchema.safeParse({ status: 'connected', map: { kind: 'unsupported', rawName: '' } })
        .success,
    ).toBe(false);
    expect(gameStateSchema.safeParse({ status: 'connected' }).success).toBe(false);
  });
});
