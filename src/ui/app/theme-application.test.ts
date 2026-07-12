import { beforeEach, describe, expect, it } from 'vitest';

import type { Settings, Theme } from '../../shared/settings';
import { useSettingsStore } from '../stores/settings-store';
import { DARK_CLASS, resolveEffectiveTheme, startThemeApplication } from './theme-application';

function makeSettings(theme: Theme): Settings {
  return {
    theme,
    cs2Path: null,
    gsiPort: null,
    autostart: false,
    closeToTray: true,
    autoUpdate: true,
    scoreboardEnabled: true,
    scoreboardLayout: { groups: [{ label: 'Match totals', fields: ['kills'] }] },
    gsiTiming: 'default',
  };
}

/** Minimal MediaQueryList test double for `(prefers-color-scheme: dark)`. */
class FakeMediaQueryList {
  matches: boolean;
  private listeners: Array<() => void> = [];

  constructor(matches: boolean) {
    this.matches = matches;
  }

  addEventListener(_type: string, listener: () => void): void {
    this.listeners.push(listener);
  }

  setSystemPrefersDark(matches: boolean): void {
    this.matches = matches;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

/** Fresh window double per test — isolates root elements and listeners. */
function makeWindow(systemPrefersDark: boolean): {
  win: Pick<Window, 'matchMedia' | 'document'>;
  media: FakeMediaQueryList;
  root: HTMLElement;
} {
  const media = new FakeMediaQueryList(systemPrefersDark);
  const doc = document.implementation.createHTMLDocument();
  return {
    win: {
      matchMedia: () => media as unknown as MediaQueryList,
      document: doc,
    },
    media,
    root: doc.documentElement,
  };
}

describe('resolveEffectiveTheme', () => {
  it.each([
    ['dark', false, 'dark'],
    ['dark', true, 'dark'],
    ['light', false, 'light'],
    ['light', true, 'light'],
    ['system', true, 'dark'],
    ['system', false, 'light'],
  ] as const)('theme %s with systemPrefersDark=%s → %s', (theme, prefersDark, expected) => {
    expect(resolveEffectiveTheme(theme, prefersDark)).toBe(expected);
  });
});

describe('startThemeApplication', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: undefined });
  });

  it('applies dark by default while settings are still undefined (UI-04)', () => {
    const { win, root } = makeWindow(false);
    startThemeApplication(win);
    expect(root.classList.contains(DARK_CLASS)).toBe(true);
  });

  it('re-themes live when the theme setting changes', () => {
    const { win, root } = makeWindow(false);
    startThemeApplication(win);

    useSettingsStore.setState({ settings: makeSettings('light') });
    expect(root.classList.contains(DARK_CLASS)).toBe(false);

    useSettingsStore.setState({ settings: makeSettings('dark') });
    expect(root.classList.contains(DARK_CLASS)).toBe(true);
  });

  it('follows OS scheme changes while the theme is "system"', () => {
    const { win, media, root } = makeWindow(false);
    startThemeApplication(win);

    useSettingsStore.setState({ settings: makeSettings('system') });
    expect(root.classList.contains(DARK_CLASS)).toBe(false);

    media.setSystemPrefersDark(true);
    expect(root.classList.contains(DARK_CLASS)).toBe(true);

    media.setSystemPrefersDark(false);
    expect(root.classList.contains(DARK_CLASS)).toBe(false);
  });

  it('ignores OS scheme changes while an explicit theme is set', () => {
    const { win, media, root } = makeWindow(false);
    startThemeApplication(win);

    useSettingsStore.setState({ settings: makeSettings('light') });
    media.setSystemPrefersDark(true);
    expect(root.classList.contains(DARK_CLASS)).toBe(false);
  });

  it('applies the current store state immediately when started late', () => {
    useSettingsStore.setState({ settings: makeSettings('light') });
    const { win, root } = makeWindow(true);
    startThemeApplication(win);
    expect(root.classList.contains(DARK_CLASS)).toBe(false);
  });
});
