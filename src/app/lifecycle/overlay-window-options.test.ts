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

  it('floats always-on-top at the default level (no screen-saver escalation)', () => {
    expect(options.alwaysOnTop).toBe(true);
    expect(options).not.toHaveProperty('alwaysOnTopLevel');
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
      backgroundThrottling: true,
    });
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
