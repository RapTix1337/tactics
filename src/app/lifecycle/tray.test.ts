import type { MenuItem } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import type { TrayMenuActions } from './tray';
import { buildTrayMenuTemplate, resolveWindowsClosedAction, TRAY_ICON_DATA_URL } from './tray';

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
    quit: vi.fn(),
  };
  const template = buildTrayMenuTemplate(actions);

  it('offers show, hide, and quit separated from the window items', () => {
    expect(template.map((item) => item.label ?? item.type)).toEqual([
      'Show',
      'Hide',
      'separator',
      'Quit',
    ]);
  });

  it.each([
    ['Show', 'showWindow'],
    ['Hide', 'hideWindow'],
    ['Quit', 'quit'],
  ] as const)('dispatches %s to the %s action', (label, action) => {
    const item = template.find((candidate) => candidate.label === label);
    item?.click?.({} as MenuItem, undefined, {});
    expect(actions[action]).toHaveBeenCalledTimes(1);
  });
});

describe('TRAY_ICON_DATA_URL', () => {
  it('embeds a valid PNG (placeholder until open question #9 resolves)', () => {
    const commaIndex = TRAY_ICON_DATA_URL.indexOf(',');
    expect(TRAY_ICON_DATA_URL.slice(0, commaIndex)).toBe('data:image/png;base64');
    // A decodable PNG signature is what nativeImage.createFromDataURL needs
    // to not silently produce an empty (invisible) tray icon.
    const bytes = Buffer.from(TRAY_ICON_DATA_URL.slice(commaIndex + 1), 'base64');
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});
