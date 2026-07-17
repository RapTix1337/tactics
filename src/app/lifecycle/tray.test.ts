import { join } from 'node:path';

import type { MenuItem } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import type { TrayMenuActions } from './tray';
import {
  buildTrayMenuTemplate,
  OVERLAY_OPACITY_RESET,
  resolveAppIconPath,
  resolveWindowsClosedAction,
} from './tray';

// E17.1 risk note: tray behaviors are hard to unit-test — the pure pieces
// (setting → close decision, menu template) are covered here; the running
// tray is E2E (tray-lifecycle.spec.ts) plus a manual check.

describe('resolveWindowsClosedAction', () => {
  it('keeps the app running when close-to-tray is enabled', () => {
    expect(resolveWindowsClosedAction(true)).toBe('keep-running');
  });

  it('quits when close-to-tray is disabled', () => {
    expect(resolveWindowsClosedAction(false)).toBe('quit');
  });
});

describe('buildTrayMenuTemplate', () => {
  const actions: TrayMenuActions = {
    showWindow: vi.fn(),
    hideWindow: vi.fn(),
    resetOverlayOpacity: vi.fn(),
    quit: vi.fn(),
  };
  const template = buildTrayMenuTemplate(actions);

  it('offers show, hide, the overlay-opacity reset, and quit, separated', () => {
    expect(template.map((item) => item.label ?? item.type)).toEqual([
      'Show',
      'Hide',
      'separator',
      'Reset overlay opacity',
      'separator',
      'Quit',
    ]);
  });

  it.each([
    ['Show', 'showWindow'],
    ['Hide', 'hideWindow'],
    ['Reset overlay opacity', 'resetOverlayOpacity'],
    ['Quit', 'quit'],
  ] as const)('dispatches %s to the %s action', (label, action) => {
    const item = template.find((candidate) => candidate.label === label);
    item?.click?.({} as MenuItem, undefined, {});
    expect(actions[action]).toHaveBeenCalledTimes(1);
  });

  it('resets exactly the four per-element opacities to 1 (ADR-060)', () => {
    expect(OVERLAY_OPACITY_RESET).toEqual({
      overlayScoreboardOpacity: 1,
      overlayMapOpacity: 1,
      overlayCalloutOpacity: 1,
      overlayChromeOpacity: 1,
    });
  });
});

describe('resolveAppIconPath', () => {
  it('reads the repo build folder in dev', () => {
    expect(resolveAppIconPath({ isPackaged: false, resourcesPath: '/res', appPath: '/app' })).toBe(
      join('/app', 'build', 'icon.ico'),
    );
  });

  it('reads the bundled resources next to the packaged app', () => {
    expect(resolveAppIconPath({ isPackaged: true, resourcesPath: '/res', appPath: '/app' })).toBe(
      join('/res', 'icon.ico'),
    );
  });
});
