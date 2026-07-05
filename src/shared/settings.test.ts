import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import type { Settings, SettingsUpdate } from './settings';
import { SETTINGS_FIELD_SCHEMAS, SETTINGS_FIELDS, settingsSchema } from './settings';

const validSettings: Settings = {
  theme: 'light',
  cs2Path: 'C:\\Games\\Counter-Strike Global Offensive',
  gsiPort: 42731,
  autostart: true,
  closeToTray: false,
  autoUpdate: false,
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
