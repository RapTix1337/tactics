import { describe, expect, it } from 'vitest';

import type {
  OperationalState,
  OperationalStateField,
  StoredOperationalState,
} from './operational-state-schema';
import {
  GSI_TOKEN_HEX_LENGTH,
  isValidGsiToken,
  mergeOperationalState,
  OPERATIONAL_STATE_DEFAULTS,
  OPERATIONAL_STATE_FIELDS,
  parseOperationalState,
} from './operational-state-schema';

const validToken = 'a'.repeat(GSI_TOKEN_HEX_LENGTH);

const validStored: StoredOperationalState = {
  gsiToken: validToken,
  effectiveGsiPort: 42731,
  windowBounds: { x: -1920, y: 0, width: 1280, height: 720, maximized: false },
};

describe('OPERATIONAL_STATE_DEFAULTS', () => {
  it('has no token (generated, never a constant) and nothing captured yet', () => {
    expect(OPERATIONAL_STATE_DEFAULTS).toEqual({
      gsiToken: null,
      effectiveGsiPort: null,
      windowBounds: null,
    });
  });
});

describe('isValidGsiToken', () => {
  it('accepts exactly a lowercase hex string of the generated length', () => {
    expect(isValidGsiToken(validToken)).toBe(true);
    expect(isValidGsiToken('0123456789abcdef'.repeat(GSI_TOKEN_HEX_LENGTH / 16))).toBe(true);
  });

  it.each<[string, unknown]>([
    ['too short', 'abc123'],
    ['too long', validToken + 'a'],
    ['uppercase hex', 'A'.repeat(GSI_TOKEN_HEX_LENGTH)],
    ['non-hex characters', 'g'.repeat(GSI_TOKEN_HEX_LENGTH)],
    ['empty string', ''],
    ['not a string', 42],
    ['null', null],
  ])('rejects %s', (_name, value) => {
    expect(isValidGsiToken(value)).toBe(false);
  });
});

describe('parseOperationalState', () => {
  it('accepts a fully valid record without fallbacks', () => {
    const { state, fallbacks } = parseOperationalState({ ...validStored });

    expect(state).toEqual(validStored);
    expect(fallbacks).toEqual([]);
  });

  it('accepts null for effectiveGsiPort and windowBounds as real values', () => {
    const { state, fallbacks } = parseOperationalState({
      ...validStored,
      effectiveGsiPort: null,
      windowBounds: null,
    });

    expect(state.effectiveGsiPort).toBeNull();
    expect(state.windowBounds).toBeNull();
    expect(fallbacks).toEqual([]);
  });

  it('accepts negative window coordinates (multi-monitor layouts)', () => {
    const { state, fallbacks } = parseOperationalState({
      ...validStored,
      windowBounds: { x: -2560, y: -400, width: 800, height: 600, maximized: true },
    });

    expect(state.windowBounds).toEqual({
      x: -2560,
      y: -400,
      width: 800,
      height: 600,
      maximized: true,
    });
    expect(fallbacks).toEqual([]);
  });

  it.each<[OperationalStateField, unknown]>([
    ['gsiToken', 'not-hex'],
    ['gsiToken', 42],
    ['gsiToken', null],
    ['effectiveGsiPort', 0],
    ['effectiveGsiPort', 65536],
    ['effectiveGsiPort', 42730.5],
    ['effectiveGsiPort', '42730'],
    ['windowBounds', { x: 0, y: 0, width: 0, height: 720, maximized: false }],
    ['windowBounds', { x: 0, y: 0, width: 1280, height: 720 }],
    ['windowBounds', { x: null, y: 0, width: 1280, height: 720, maximized: false }],
    ['windowBounds', 'somewhere'],
  ])('falls back only for the invalid field: %s = %j keeps the others', (field, bad) => {
    const { state, fallbacks } = parseOperationalState({ ...validStored, [field]: bad });

    expect(fallbacks).toEqual([field]);
    expect(state[field]).toEqual(OPERATIONAL_STATE_DEFAULTS[field]);
    for (const other of OPERATIONAL_STATE_FIELDS.filter((f) => f !== field)) {
      expect(state[other]).toEqual(validStored[other]);
    }
  });

  it('treats window bounds as all-or-nothing: one bad member drops the whole bounds', () => {
    const { state, fallbacks } = parseOperationalState({
      ...validStored,
      windowBounds: { x: 0, y: 0, width: 1280, height: 720, maximized: 7 },
    });

    expect(state.windowBounds).toBeNull();
    expect(fallbacks).toEqual(['windowBounds']);
  });

  it('falls back on every field for an empty record', () => {
    const { state, fallbacks } = parseOperationalState({});

    expect(state).toEqual(OPERATIONAL_STATE_DEFAULTS);
    expect(fallbacks).toEqual([...OPERATIONAL_STATE_FIELDS]);
  });

  it('ignores unknown keys', () => {
    const { state, fallbacks } = parseOperationalState({ ...validStored, id: 1, legacy: true });

    expect(state).toEqual(validStored);
    expect(fallbacks).toEqual([]);
  });
});

describe('mergeOperationalState', () => {
  const current: OperationalState = { ...validStored, gsiToken: validToken };

  it('overrides only the given fields and never the token', () => {
    const merged = mergeOperationalState(current, { effectiveGsiPort: 42735 });

    expect(merged).toEqual({ ...current, effectiveGsiPort: 42735 });
  });

  it('treats an explicit null as a value (port back to automatic, bounds cleared)', () => {
    const merged = mergeOperationalState(current, { effectiveGsiPort: null, windowBounds: null });

    expect(merged.effectiveGsiPort).toBeNull();
    expect(merged.windowBounds).toBeNull();
    expect(merged.gsiToken).toBe(validToken);
  });

  it('ignores explicitly undefined fields', () => {
    const merged = mergeOperationalState(current, { effectiveGsiPort: undefined });

    expect(merged).toEqual(current);
  });

  it('does not mutate the current state', () => {
    const snapshot = { ...current };

    mergeOperationalState(current, { windowBounds: null });

    expect(current).toEqual(snapshot);
  });
});
