import { describe, expect, it } from 'vitest';

import { isOwnPlayer } from './identity';

// Freeze bias (03-plan.md SCB.5 risk note): whenever identity is uncertain,
// the answer is "not the own player" — the engine then keeps the last own
// snapshot instead of adopting a spectated teammate's stats (spec AC 11).
describe('isOwnPlayer', () => {
  const OWN = '76561190000000000';
  const OTHER = '76561190000000001';

  it('accepts a player block whose steamid equals the provider steamid', () => {
    expect(isOwnPlayer(OWN, OWN)).toBe(true);
  });

  it('rejects a spectated teammate (differing steamid)', () => {
    expect(isOwnPlayer(OWN, OTHER)).toBe(false);
  });

  it('rejects when the provider steamid is missing', () => {
    expect(isOwnPlayer(null, OWN)).toBe(false);
  });

  it('rejects when the player steamid is missing', () => {
    expect(isOwnPlayer(OWN, null)).toBe(false);
  });

  it('rejects when both steamids are missing', () => {
    expect(isOwnPlayer(null, null)).toBe(false);
  });
});
