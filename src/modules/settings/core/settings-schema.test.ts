import { describe, expect, it } from 'vitest';

import type { Settings, SettingsField } from '../../../shared';
import { SETTINGS_FIELDS } from '../../../shared';
import { mergeSettings, parseSettings, SETTINGS_DEFAULTS } from './settings-schema';

const validStored: Settings = {
  theme: 'light',
  cs2Path: 'C:\\Games\\Counter-Strike Global Offensive',
  gsiPort: 42731,
  autostart: true,
  closeToTray: false,
  autoUpdate: false,
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
    ['autoUpdate', undefined],
  ])('falls back only for the invalid field: %s = %j keeps the other five', (field, bad) => {
    const { settings, fallbacks } = parseSettings({ ...validStored, [field]: bad });

    expect(fallbacks).toEqual([field]);
    expect(settings[field]).toEqual(SETTINGS_DEFAULTS[field]);
    for (const other of SETTINGS_FIELDS.filter((f) => f !== field)) {
      expect(settings[other]).toEqual(validStored[other]);
    }
  });

  it('falls back on every field for an empty record', () => {
    const { settings, fallbacks } = parseSettings({});

    expect(settings).toEqual(SETTINGS_DEFAULTS);
    expect(fallbacks).toEqual([...SETTINGS_FIELDS]);
  });

  it('ignores unknown keys', () => {
    const { settings, fallbacks } = parseSettings({ ...validStored, id: 1, legacyFlag: true });

    expect(settings).toEqual(validStored);
    expect(fallbacks).toEqual([]);
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
