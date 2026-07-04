import { describe, expect, it } from 'vitest';

import {
  buildMainWindowOptions,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
} from './window-options';

// E3.1 acceptance criterion "hardening flags verified by an integration
// test (webPreferences assertions) where feasible": the options builder is
// pure, so the flags are asserted here without launching Electron; the
// running-app evidence is the E2E spike's job (E4.1).
describe('buildMainWindowOptions', () => {
  const preloadPath = '/out/preload/index.cjs';
  const options = buildMainWindowOptions(preloadPath);

  it('pins all ADR-025 webPreferences hardening flags', () => {
    expect(options.webPreferences).toMatchObject({
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      backgroundThrottling: true,
    });
  });

  it('enforces the UI-05 minimum window size of 1024×700', () => {
    expect(MIN_WINDOW_WIDTH).toBe(1024);
    expect(MIN_WINDOW_HEIGHT).toBe(700);
    expect(options.minWidth).toBe(MIN_WINDOW_WIDTH);
    expect(options.minHeight).toBe(MIN_WINDOW_HEIGHT);
  });

  it('opens at or above the minimum size, hidden until ready-to-show', () => {
    expect(DEFAULT_WINDOW_WIDTH).toBeGreaterThanOrEqual(MIN_WINDOW_WIDTH);
    expect(DEFAULT_WINDOW_HEIGHT).toBeGreaterThanOrEqual(MIN_WINDOW_HEIGHT);
    expect(options.width).toBe(DEFAULT_WINDOW_WIDTH);
    expect(options.height).toBe(DEFAULT_WINDOW_HEIGHT);
    expect(options.show).toBe(false);
  });
});
