// Unit tests for the capture-tool sanitizer (SCB.1). The sanitizer is the
// ADR-030 guarantee for the fixture corpus: whatever CS2 sends, nothing
// identifying may reach the disk. The corpus-side counterpart is the hygiene
// block in src/modules/gsi/core/payload-schema.test.ts.
import { describe, expect, it } from 'vitest';

import { sanitize } from './gsi-sanitize.mjs';

describe('sanitize', () => {
  it('keeps the player section with steamid, name, and clan replaced', () => {
    const result = sanitize({
      player: {
        steamid: '76561198012345678',
        name: 'RealNickname',
        clan: 'ClanTag',
        team: 'CT',
        match_stats: { kills: 7, assists: 2, deaths: 3, mvps: 1, score: 18 },
        state: { health: 100, armor: 100, helmet: true, round_kills: 1 },
      },
    });
    expect(result.player).toEqual({
      steamid: '76561190000000000',
      name: 'Player',
      clan: 'REDACTED',
      team: 'CT',
      match_stats: { kills: 7, assists: 2, deaths: 3, mvps: 1, score: 18 },
      state: { health: 100, armor: 100, helmet: true, round_kills: 1 },
    });
  });

  it('maps foreign steamids to the distinct spectate placeholder', () => {
    // The own-vs-other distinction must survive sanitization: the SCB.1
    // dead-spectate fixtures are only useful if the player block visibly
    // flips, and the capture tool's coverage seeding re-reads stored files.
    const result = sanitize({
      provider: { steamid: '76561198012345678' },
      player: { steamid: '76561198087654321', name: 'Teammate' },
      previously: { player: { steamid: '76561198012345678' } },
    });
    expect(result.provider.steamid).toBe('76561190000000000');
    expect(result.player.steamid).toBe('76561190000000001');
    expect(result.previously.player.steamid).toBe('76561190000000000');
  });

  it('maps the own steamid in the player block to the own placeholder', () => {
    const result = sanitize({
      provider: { steamid: '76561198012345678' },
      player: { steamid: '76561198012345678', name: 'Me' },
    });
    expect(result.player.steamid).toBe('76561190000000000');
  });

  it('leaves provider.name and map.name untouched, replaces provider.steamid', () => {
    const result = sanitize({
      provider: {
        name: 'Counter-Strike: Global Offensive',
        steamid: '76561198012345678',
        timestamp: 1783257728,
      },
      map: { name: 'de_dust2', mode: 'competitive' },
    });
    expect(result.provider.name).toBe('Counter-Strike: Global Offensive');
    expect(result.provider.steamid).toBe('76561190000000000');
    expect(result.map).toEqual({ name: 'de_dust2', mode: 'competitive' });
  });

  it('sanitizes player fragments nested under previously/added', () => {
    const result = sanitize({
      previously: {
        player: { name: 'RealNickname', state: { health: 34 } },
        map: { phase: 'warmup' },
      },
      added: { player: { clan: 'ClanTag' } },
    });
    expect(result.previously).toEqual({
      player: { name: 'Player', state: { health: 34 } },
      map: { phase: 'warmup' },
    });
    expect(result.added).toEqual({ player: { clan: 'REDACTED' } });
  });

  it('drops allplayers sections at any depth (defense in depth)', () => {
    const result = sanitize({
      allplayers: { '76561198000000001': { name: 'Someone' } },
      previously: { allplayers: { '76561198000000001': { name: 'Someone' } } },
      map: { name: 'de_mirage' },
    });
    expect(result).toEqual({ previously: {}, map: { name: 'de_mirage' } });
  });

  it('redacts every value inside auth objects', () => {
    const result = sanitize({ auth: { token: 'secret-token-value' } });
    expect(result.auth).toEqual({ token: 'REDACTED' });
  });

  it('leaves name fields outside player subtrees untouched', () => {
    const result = sanitize({ map: { name: 'de_inferno' }, provider: { name: 'CS' } });
    expect(result).toEqual({ map: { name: 'de_inferno' }, provider: { name: 'CS' } });
  });

  it('passes primitives, null, and arrays through structurally', () => {
    expect(sanitize(null)).toBe(null);
    expect(sanitize(42)).toBe(42);
    expect(sanitize('text')).toBe('text');
    expect(sanitize([{ player: { name: 'RealNickname' } }, 1])).toEqual([
      { player: { name: 'Player' } },
      1,
    ]);
  });

  it('does not mutate its input', () => {
    const input = { player: { name: 'RealNickname', steamid: '76561198012345678' } };
    sanitize(input);
    expect(input.player.name).toBe('RealNickname');
    expect(input.player.steamid).toBe('76561198012345678');
  });
});
