import { describe, expect, it } from 'vitest';

import { mapJsonSchema, parseMapJson } from './map-schema';

/** Hand-written minimal catalog entry + default layout (ADR-045 shape). */
function sample(): Record<string, unknown> {
  return {
    id: 'de_dust2',
    displayName: 'Dust 2',
    gsiNames: ['de_dust2'],
    callouts: [
      { name: 'Long Doors', x: 0.69, y: 0.715 },
      { name: 'B Tunnels', x: 0.32, y: 0.665 },
    ],
  };
}

function parseSample(input: Record<string, unknown>): ReturnType<typeof parseMapJson> {
  return parseMapJson(JSON.stringify(input));
}

function expectRejected(input: Record<string, unknown>, issueFragment: string): void {
  const result = parseSample(input);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe('INVALID_SHAPE');
    expect(result.error.issues.join('\n')).toContain(issueFragment);
  }
}

describe('parseMapJson — accepted samples', () => {
  it('accepts the minimal sample', () => {
    const result = parseSample(sample());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.map.id).toBe('de_dust2');
      expect(result.map.callouts[0]).toEqual({ name: 'Long Doors', x: 0.69, y: 0.715 });
    }
  });

  it('accepts an empty default layout (catalog entry before E12.3 curates it)', () => {
    const input = sample();
    input.callouts = [];
    expect(parseSample(input).ok).toBe(true);
  });

  it('accepts multiple GSI alias names', () => {
    const input = sample();
    input.gsiNames = ['de_dust2', 'workshop/123/de_dust2'];
    expect(parseSample(input).ok).toBe(true);
  });

  it('accepts callouts on the normalized boundary values 0 and 1', () => {
    const input = sample();
    input.callouts = [{ name: 'Corner', x: 0, y: 1 }];
    expect(parseSample(input).ok).toBe(true);
  });
});

describe('parseMapJson — rejected input', () => {
  it('rejects content that is not JSON', () => {
    const result = parseMapJson('not json at all {');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_JSON');
    }
  });

  it('rejects a missing required field with the field path in the issue', () => {
    const input = sample();
    delete input.displayName;
    expectRejected(input, 'displayName');
  });

  it('rejects unknown keys (strict objects)', () => {
    const input = sample();
    input.calouts = input.callouts; // typo key must fail, not vanish
    expectRejected(input, 'calouts');
  });

  it('rejects retired pre-ADR-045 fields (levels, bomb sites, spawns)', () => {
    const input = sample();
    input.levels = [{ id: 'main', displayName: 'Main', svgFile: 'main.svg' }];
    expectRejected(input, 'levels');
  });

  it('rejects a map id that is not engine-style lowercase', () => {
    const input = sample();
    input.id = 'De Dust2';
    expectRejected(input, 'id');
  });

  it('rejects an empty gsiNames list', () => {
    const input = sample();
    input.gsiNames = [];
    expectRejected(input, 'gsiNames');
  });

  it('rejects duplicate GSI names', () => {
    const input = sample();
    input.gsiNames = ['de_dust2', 'de_dust2'];
    expectRejected(input, 'duplicate GSI name "de_dust2"');
  });

  it('rejects duplicate callout names', () => {
    const input = sample();
    input.callouts = [
      { name: 'Long Doors', x: 0.1, y: 0.1 },
      { name: 'Long Doors', x: 0.2, y: 0.2 },
    ];
    expectRejected(input, 'duplicate callout name "Long Doors"');
  });

  it('rejects an out-of-range coordinate (positions are normalized 0–1)', () => {
    const input = sample();
    input.callouts = [{ name: 'Long Doors', x: 612, y: 0.5 }];
    expectRejected(input, 'callouts.0.x');
  });

  it('rejects a negative coordinate', () => {
    const input = sample();
    input.callouts = [{ name: 'Long Doors', x: 0.5, y: -0.1 }];
    expectRejected(input, 'callouts.0.y');
  });
});

describe('mapJsonSchema — direct object validation', () => {
  it('rejects non-finite coordinates (unreachable via JSON, guarded anyway)', () => {
    const input = sample();
    input.callouts = [{ name: 'Long Doors', x: Infinity, y: 0 }];
    expect(mapJsonSchema.safeParse(input).success).toBe(false);
  });
});
