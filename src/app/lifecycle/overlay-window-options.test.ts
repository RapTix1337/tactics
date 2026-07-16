import { describe, expect, it } from 'vitest';

import { APP_NAME } from '../../shared';
import {
  buildOverlayWindowOptions,
  OVERLAY_DEFAULT_HEIGHT,
  OVERLAY_DEFAULT_WIDTH,
} from './overlay-window-options';

// OVL.3 acceptance criterion: the options builder is unit-tested flag by
// flag (the window-options.test.ts pattern), including every hardening
// flag — the ADR-057 mechanism decisions are pinned before any Electron
// wiring exists (OVL.4).
describe('buildOverlayWindowOptions', () => {
  const preloadPath = '/out/preload/index.cjs';
  const options = buildOverlayWindowOptions(preloadPath);

  it('is transparent and frameless (the ADR-057 mechanism)', () => {
    expect(options.transparent).toBe(true);
    expect(options.frame).toBe(false);
  });

  // The screen-saver level escalation lives in the window factory
  // (app-lifecycle.ts): BrowserWindowConstructorOptions cannot express a
  // z-level, only the flag (2026-07-16 field fix, spec AC 2).
  it('requests always-on-top at construction', () => {
    expect(options.alwaysOnTop).toBe(true);
  });

  it('disables native resize/maximize/minimize (resize is ours, §3.1)', () => {
    expect(options.resizable).toBe(false);
    expect(options.maximizable).toBe(false);
    expect(options.minimizable).toBe(false);
  });

  it('keeps the taskbar entry for recovery/alt-tab reachability', () => {
    expect(options.skipTaskbar).toBe(false);
    expect(options.title).toBe(`${APP_NAME} Overlay`);
  });

  it('pins all ADR-025 webPreferences hardening flags', () => {
    expect(options.webPreferences).toMatchObject({
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
    });
  });

  // Regression (2026-07-16): with throttling on, Chromium's Windows occlusion
  // tracker marks every window occluded while a fullscreen-sized foreground
  // window (borderless CS2) is active — topmost or not — and the paused
  // renderer paints nothing on a transparent window: invisible overlay whose
  // HWND still steals the mouse. backgroundThrottling: false keeps the
  // visibility state 'visible' even when marked occluded (Electron docs), so
  // the overlay keeps painting above the game (spec AC 2).
  it('disables background throttling so the fullscreen-occlusion heuristic cannot blank the overlay', () => {
    expect(options.webPreferences?.backgroundThrottling).toBe(false);
  });

  it('opens hidden at the 960×540 default, OS-centered (no x/y)', () => {
    expect(OVERLAY_DEFAULT_WIDTH).toBe(960);
    expect(OVERLAY_DEFAULT_HEIGHT).toBe(540);
    expect(options.width).toBe(OVERLAY_DEFAULT_WIDTH);
    expect(options.height).toBe(OVERLAY_DEFAULT_HEIGHT);
    expect(options.show).toBe(false);
    expect(options).not.toHaveProperty('x');
    expect(options).not.toHaveProperty('y');
  });

  it('applies restored initial bounds while keeping the hardening intact', () => {
    const restored = buildOverlayWindowOptions(preloadPath, {
      x: 300,
      y: 180,
      width: 1280,
      height: 720,
    });

    expect(restored).toMatchObject({ x: 300, y: 180, width: 1280, height: 720 });
    expect(restored.transparent).toBe(true);
    expect(restored.frame).toBe(false);
    expect(restored.alwaysOnTop).toBe(true);
    expect(restored.show).toBe(false);
    expect(restored.webPreferences).toEqual(options.webPreferences);
  });
});
