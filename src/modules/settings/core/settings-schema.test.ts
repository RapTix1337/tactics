import { describe, expect, it } from 'vitest';

import type { ScoreboardLayout, Settings, SettingsField } from '../../../shared';
import { SETTINGS_FIELDS } from '../../../shared';
import {
  DEFAULT_SCOREBOARD_LAYOUT,
  mergeSettings,
  parseSettings,
  SETTINGS_DEFAULTS,
} from './settings-schema';

const storedLayout: ScoreboardLayout = {
  groups: [{ label: 'Custom', fields: ['kills', 'money'] }],
};

const validStored: Settings = {
  theme: 'light',
  cs2Path: 'C:\\Games\\Counter-Strike Global Offensive',
  gsiPort: 42731,
  autostart: true,
  closeToTray: false,
  autoUpdate: false,
  scoreboardEnabled: false,
  scoreboardLayout: storedLayout,
  gsiTiming: 'slow',
  overlayScoreboardOpacity: 0.4,
  overlayMapOpacity: 0.6,
  overlayCalloutOpacity: 0.2,
  overlayChromeOpacity: 0.8,
};

describe('SETTINGS_DEFAULTS', () => {
  it('matches the binding defaults of 03-technical-design.md §7.3 exactly', () => {
    expect(SETTINGS_DEFAULTS).toEqual({
      theme: 'dark',
      cs2Path: null,
      gsiPort: null,
      autostart: false,
      closeToTray: true,
      autoUpdate: true,
      scoreboardEnabled: true,
      scoreboardLayout: DEFAULT_SCOREBOARD_LAYOUT,
      gsiTiming: 'default',
      overlayScoreboardOpacity: 1,
      overlayMapOpacity: 1,
      overlayCalloutOpacity: 1,
      overlayChromeOpacity: 1,
    });
  });

  it('uses the Designer card layout as the default (ADR-053, design §4)', () => {
    expect(DEFAULT_SCOREBOARD_LAYOUT).toEqual({
      groups: [
        { label: 'Match totals', fields: ['kills', 'deaths', 'assists', 'kd', 'mvps'] },
        { label: 'Derived', fields: ['hsRate'] },
        { label: 'Live round state', fields: ['health', 'armor', 'money', 'equipValue'] },
      ],
    });
  });
});

describe('parseSettings', () => {
  it('accepts a fully valid record without fallbacks', () => {
    const { settings, fallbacks } = parseSettings({ ...validStored });

    expect(settings).toEqual(validStored);
    expect(fallbacks).toEqual([]);
  });

  it('accepts null for cs2Path and gsiPort as a real value (automatic mode)', () => {
    const { settings, fallbacks } = parseSettings({ ...validStored, cs2Path: null, gsiPort: null });

    expect(settings.cs2Path).toBeNull();
    expect(settings.gsiPort).toBeNull();
    expect(fallbacks).toEqual([]);
  });

  it.each<[SettingsField, unknown]>([
    ['theme', 'blurple'],
    ['theme', null],
    ['cs2Path', ''],
    ['cs2Path', 42],
    ['gsiPort', 0],
    ['gsiPort', 65536],
    ['gsiPort', 42730.5],
    ['gsiPort', '42730'],
    ['autostart', 'yes'],
    ['autostart', null],
    ['closeToTray', 2],
    ['autoUpdate', null],
    ['scoreboardEnabled', 'yes'],
    ['scoreboardLayout', '{"groups":[]}'],
    ['scoreboardLayout', { groups: [{ label: 'Empty', fields: [] }] }],
    ['gsiTiming', 'turbo'],
    ['gsiTiming', null],
    ['overlayScoreboardOpacity', 1.5],
    ['overlayScoreboardOpacity', '0.5'],
    ['overlayMapOpacity', -0.1],
    ['overlayCalloutOpacity', true],
    ['overlayChromeOpacity', null],
  ])('falls back only for the invalid field: %s = %j keeps the others', (field, bad) => {
    const { settings, fallbacks } = parseSettings({ ...validStored, [field]: bad });

    expect(fallbacks).toEqual([field]);
    expect(settings[field]).toEqual(SETTINGS_DEFAULTS[field]);
    for (const other of SETTINGS_FIELDS.filter((f) => f !== field)) {
      expect(settings[other]).toEqual(validStored[other]);
    }
  });

  it('applies the default silently for an absent field (version skew, not corruption)', () => {
    // The OVL.1 state: fields exist in the schema before their columns are
    // migrated. Absence is the first-run precedent (silent defaults), not a
    // corrupt value — only present-but-invalid values warrant a fallback log.
    const {
      overlayScoreboardOpacity,
      overlayMapOpacity,
      overlayCalloutOpacity,
      overlayChromeOpacity,
      ...withoutOverlay
    } = validStored;
    void overlayScoreboardOpacity;
    void overlayMapOpacity;
    void overlayCalloutOpacity;
    void overlayChromeOpacity;

    const { settings, fallbacks } = parseSettings(withoutOverlay);

    expect(fallbacks).toEqual([]);
    expect(settings).toEqual({
      ...validStored,
      overlayScoreboardOpacity: SETTINGS_DEFAULTS.overlayScoreboardOpacity,
      overlayMapOpacity: SETTINGS_DEFAULTS.overlayMapOpacity,
      overlayCalloutOpacity: SETTINGS_DEFAULTS.overlayCalloutOpacity,
      overlayChromeOpacity: SETTINGS_DEFAULTS.overlayChromeOpacity,
    });
  });

  it('treats an explicitly undefined field like an absent one', () => {
    const { settings, fallbacks } = parseSettings({ ...validStored, autoUpdate: undefined });

    expect(fallbacks).toEqual([]);
    expect(settings.autoUpdate).toBe(SETTINGS_DEFAULTS.autoUpdate);
  });

  it('applies all defaults for an empty record without a single fallback log', () => {
    const { settings, fallbacks } = parseSettings({});

    expect(settings).toEqual(SETTINGS_DEFAULTS);
    expect(fallbacks).toEqual([]);
  });

  it('ignores unknown keys', () => {
    const { settings, fallbacks } = parseSettings({ ...validStored, id: 1, legacyFlag: true });

    expect(settings).toEqual(validStored);
    expect(fallbacks).toEqual([]);
  });

  it('falls back on the whole layout for a partially invalid one — never partially', () => {
    const { settings, fallbacks } = parseSettings({
      ...validStored,
      // First group is fine on its own; the second is malformed (no label).
      scoreboardLayout: { groups: [{ label: 'Fine', fields: ['kills'] }, { fields: ['deaths'] }] },
    });

    expect(fallbacks).toEqual(['scoreboardLayout']);
    expect(settings.scoreboardLayout).toEqual(DEFAULT_SCOREBOARD_LAYOUT);
  });

  it('normalizes a layout with unknown and duplicate ids instead of falling back', () => {
    const { settings, fallbacks } = parseSettings({
      ...validStored,
      scoreboardLayout: { groups: [{ label: 'A', fields: ['kills', 'kills', 'adr', 'deaths'] }] },
    });

    expect(fallbacks).toEqual([]);
    expect(settings.scoreboardLayout).toEqual({
      groups: [{ label: 'A', fields: ['kills', 'deaths'] }],
    });
  });
});

describe('mergeSettings', () => {
  it('overrides only the given fields', () => {
    const merged = mergeSettings(SETTINGS_DEFAULTS, { theme: 'system', autostart: true });

    expect(merged).toEqual({ ...SETTINGS_DEFAULTS, theme: 'system', autostart: true });
  });

  it('treats an explicit null as a value, resetting to automatic', () => {
    const merged = mergeSettings(validStored, { cs2Path: null, gsiPort: null });

    expect(merged.cs2Path).toBeNull();
    expect(merged.gsiPort).toBeNull();
  });

  it('ignores explicitly undefined fields', () => {
    const merged = mergeSettings(validStored, { theme: undefined });

    expect(merged).toEqual(validStored);
  });

  it('does not mutate the current settings', () => {
    const current = { ...validStored };

    mergeSettings(current, { theme: 'dark' });

    expect(current).toEqual(validStored);
  });
});
