import { describe, expect, it } from 'vitest';

import { buildMapIndex } from './map-index';
import type { MapData } from './map-schema';

function makeMap(id: string, gsiNames: readonly string[]): MapData {
  return {
    id,
    displayName: id.toUpperCase(),
    gsiNames: [...gsiNames],
    callouts: [{ name: 'Mid', x: 0.5, y: 0.5 }],
  };
}

describe('buildMapIndex', () => {
  it('is empty without maps', () => {
    const index = buildMapIndex([]);

    expect(index.summaries).toEqual([]);
    expect(index.conflicts).toEqual([]);
    expect(index.getMap('de_dust2')).toBeUndefined();
    expect(index.resolveGsiMapName('de_dust2')).toBeUndefined();
  });

  it('derives summaries in load order', () => {
    const index = buildMapIndex([
      makeMap('de_nuke', ['de_nuke']),
      makeMap('de_dust2', ['de_dust2']),
    ]);

    expect(index.summaries).toEqual([
      { id: 'de_nuke', displayName: 'DE_NUKE' },
      { id: 'de_dust2', displayName: 'DE_DUST2' },
    ]);
  });

  it('returns the full map data by id', () => {
    const map = makeMap('de_dust2', ['de_dust2']);
    const index = buildMapIndex([map]);

    expect(index.getMap('de_dust2')).toBe(map);
    expect(index.getMap('de_inferno')).toBeUndefined();
  });

  describe('resolveGsiMapName', () => {
    const index = buildMapIndex([makeMap('de_dust2', ['de_dust2', 'workshop_dust2'])]);

    it('resolves the primary GSI name', () => {
      expect(index.resolveGsiMapName('de_dust2')).toBe('de_dust2');
    });

    it('resolves an alias to the same map', () => {
      expect(index.resolveGsiMapName('workshop_dust2')).toBe('de_dust2');
    });

    it('returns undefined for an unknown name (exact match only)', () => {
      expect(index.resolveGsiMapName('de_unknown')).toBeUndefined();
      expect(index.resolveGsiMapName('DE_DUST2')).toBeUndefined();
    });
  });

  it('keeps the first map on a GSI name conflict and reports it', () => {
    const index = buildMapIndex([
      makeMap('de_dust2', ['de_dust2', 'shared_name']),
      makeMap('de_inferno', ['de_inferno', 'shared_name']),
    ]);

    expect(index.resolveGsiMapName('shared_name')).toBe('de_dust2');
    expect(index.resolveGsiMapName('de_inferno')).toBe('de_inferno');
    expect(index.conflicts).toEqual([
      { gsiName: 'shared_name', keptMapId: 'de_dust2', ignoredMapId: 'de_inferno' },
    ]);
  });
});
