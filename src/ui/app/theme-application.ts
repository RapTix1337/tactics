import type { Theme } from '../../shared/settings';
import { useSettingsStore } from '../stores/settings-store';

/**
 * Theme application (UI-04, 06-ui.md §4): the effective theme is applied as
 * the `dark` class on the root element; the CSS tokens in assets/globals.css
 * carry both themes. Driven by the settings store; `'system'` follows the
 * OS via the `prefers-color-scheme` media query.
 */
export const DARK_CLASS = 'dark';

const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

/** Dark is the app default (UI-04) — used until the settings slice arrives. */
const DEFAULT_THEME: Theme = 'dark';

export function resolveEffectiveTheme(theme: Theme, systemPrefersDark: boolean): 'dark' | 'light' {
  if (theme === 'system') {
    return systemPrefersDark ? 'dark' : 'light';
  }
  return theme;
}

/**
 * Applies the theme once and keeps it applied: re-runs on every settings
 * change and on OS scheme changes (relevant while the theme is `'system'`;
 * otherwise the re-run is an idempotent no-op). Runs before the first React
 * render and lives as long as the window — nothing to dispose.
 */
export function startThemeApplication(win: Pick<Window, 'matchMedia' | 'document'>): void {
  const media = win.matchMedia(SYSTEM_DARK_QUERY);
  const root = win.document.documentElement;

  const apply = (): void => {
    const theme = useSettingsStore.getState().settings?.theme ?? DEFAULT_THEME;
    const effective = resolveEffectiveTheme(theme, media.matches);
    root.classList.toggle(DARK_CLASS, effective === 'dark');
  };

  apply();
  useSettingsStore.subscribe(apply);
  media.addEventListener('change', apply);
}
