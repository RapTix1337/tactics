import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import type { FieldId, ScoreboardLayout, Settings, SettingsUpdate } from './settings';
import {
  FIELD_IDS,
  SCOREBOARD_GROUP_LABEL_MAX_LENGTH,
  scoreboardLayoutSchema,
  SETTINGS_FIELD_SCHEMAS,
  SETTINGS_FIELDS,
  settingsSchema,
} from './settings';

const validLayout: ScoreboardLayout = {
  groups: [
    { label: 'Match totals', fields: ['kills', 'deaths', 'assists'] },
    { label: 'Live round state', fields: ['health', 'money'] },
  ],
};

const validSettings: Settings = {
  theme: 'light',
  cs2Path: 'C:\\Games\\Counter-Strike Global Offensive',
  gsiPort: 42731,
  autostart: true,
  closeToTray: false,
  autoUpdate: false,
  scoreboardEnabled: false,
  scoreboardLayout: validLayout,
  gsiTiming: 'fast',
};

describe('settingsSchema', () => {
  it('accepts a full valid settings object and rejects a partial one', () => {
    expect(settingsSchema.safeParse(validSettings).success).toBe(true);
    expect(settingsSchema.safeParse({ theme: 'light' }).success).toBe(false);
  });

  it('infers exactly the Settings interface (both directions, type level)', () => {
    expectTypeOf<z.infer<typeof settingsSchema>>().toExtend<Settings>();
    expectTypeOf<Settings>().toExtend<z.infer<typeof settingsSchema>>();
  });

  it('covers every settings field with a per-field schema (type level)', () => {
    expectTypeOf<keyof typeof SETTINGS_FIELD_SCHEMAS>().toEqualTypeOf<keyof Settings>();
    expectTypeOf<(typeof SETTINGS_FIELDS)[number]>().toEqualTypeOf<keyof Settings>();
  });

  it('accepts an update as a partial of the same fields (type level)', () => {
    expectTypeOf<SettingsUpdate>().toExtend<Partial<Settings>>();
  });
});

describe('scoreboardLayoutSchema', () => {
  it('accepts a valid layout unchanged, including an empty group (transient builder state)', () => {
    const layout: ScoreboardLayout = {
      groups: [...validLayout.groups, { label: 'New group', fields: [] }],
    };

    expect(scoreboardLayoutSchema.parse(layout)).toEqual(layout);
  });

  it('drops unknown field ids instead of failing the layout (forward compatibility)', () => {
    const parsed = scoreboardLayoutSchema.parse({
      groups: [{ label: 'Totals', fields: ['kills', 'adr', 'futureField', 'deaths'] }],
    });

    expect(parsed).toEqual({ groups: [{ label: 'Totals', fields: ['kills', 'deaths'] }] });
  });

  it('collapses duplicate field ids across groups — the first occurrence wins', () => {
    const parsed = scoreboardLayoutSchema.parse({
      groups: [
        { label: 'A', fields: ['kills', 'kills', 'deaths'] },
        { label: 'B', fields: ['deaths', 'money'] },
      ],
    });

    expect(parsed).toEqual({
      groups: [
        { label: 'A', fields: ['kills', 'deaths'] },
        { label: 'B', fields: ['money'] },
      ],
    });
  });

  it('rejects a layout without a single field across all groups', () => {
    expect(scoreboardLayoutSchema.safeParse({ groups: [] }).success).toBe(false);
    expect(
      scoreboardLayoutSchema.safeParse({ groups: [{ label: 'Empty', fields: [] }] }).success,
    ).toBe(false);
    // Only unknown ids ⇒ nothing survives the drop ⇒ still invalid.
    expect(
      scoreboardLayoutSchema.safeParse({ groups: [{ label: 'X', fields: ['adr'] }] }).success,
    ).toBe(false);
  });

  it('caps group labels at the documented maximum', () => {
    const atCap = 'x'.repeat(SCOREBOARD_GROUP_LABEL_MAX_LENGTH);

    expect(
      scoreboardLayoutSchema.safeParse({ groups: [{ label: atCap, fields: ['kills'] }] }).success,
    ).toBe(true);
    expect(
      scoreboardLayoutSchema.safeParse({ groups: [{ label: `${atCap}y`, fields: ['kills'] }] })
        .success,
    ).toBe(false);
  });

  it('rejects malformed shapes instead of normalizing them', () => {
    expect(scoreboardLayoutSchema.safeParse(null).success).toBe(false);
    expect(scoreboardLayoutSchema.safeParse({ groups: 'kills' }).success).toBe(false);
    expect(scoreboardLayoutSchema.safeParse({ groups: [{ fields: ['kills'] }] }).success).toBe(
      false,
    );
  });

  it('covers the closed field id set exactly (type level, no adr — ADR-055)', () => {
    expectTypeOf<(typeof FIELD_IDS)[number]>().toEqualTypeOf<FieldId>();
    expectTypeOf<FieldId>().toEqualTypeOf<
      | 'kills'
      | 'assists'
      | 'deaths'
      | 'mvps'
      | 'score'
      | 'kd'
      | 'kMinusD'
      | 'hsRate'
      | 'hsKills'
      | 'health'
      | 'armor'
      | 'money'
      | 'equipValue'
      | 'roundKills'
      | 'roundHsKills'
    >();
  });
});
