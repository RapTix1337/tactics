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

  it('leaves x/y unset without initial bounds so Electron centers the window', () => {
    expect(options).not.toHaveProperty('x');
    expect(options).not.toHaveProperty('y');
  });

  // E17.3: the restored placement replaces the default one; everything else
  // (hardening, min size, hidden start) is unaffected by the restore path.
  it('applies restored initial bounds while keeping the hardening intact', () => {
    const restored = buildMainWindowOptions(preloadPath, {
      x: 200,
      y: 120,
      width: 1400,
      height: 900,
    });

    expect(restored).toMatchObject({ x: 200, y: 120, width: 1400, height: 900 });
    expect(restored.minWidth).toBe(MIN_WINDOW_WIDTH);
    expect(restored.minHeight).toBe(MIN_WINDOW_HEIGHT);
    expect(restored.show).toBe(false);
    expect(restored.webPreferences).toEqual(options.webPreferences);
  });
});
