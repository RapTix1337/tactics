import { describe, expect, it, vi } from 'vitest';

import { applyOverlayCompositionSwitches } from './chromium-switches';

// Regression (2026-07-16, overlay field test round 3): Chromium's native
// window occlusion tracker re-marks the overlay occluded on geometry
// changes while a fullscreen-sized window (borderless CS2) is foreground —
// the per-window backgroundThrottling exemption did not cover the
// compositor's presentation path (overlay invisible after move + refocus
// even with desktop composition forced on).
describe('applyOverlayCompositionSwitches', () => {
  it('disables Chromium native window occlusion tracking app-wide', () => {
    const appendSwitch = vi.fn();

    applyOverlayCompositionSwitches({ appendSwitch });

    expect(appendSwitch).toHaveBeenCalledExactlyOnceWith(
      'disable-features',
      'CalculateNativeWinOcclusion',
    );
  });
});
