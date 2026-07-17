import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { success } from '../../../shared/envelope';
import type { Settings } from '../../../shared/settings';
import { updateSettings } from '../../lib/ipc/settings';
import { useSettingsStore } from '../../stores/settings-store';
import { OverlayControls } from './OverlayControls';

vi.mock('../../lib/ipc/settings', () => ({ updateSettings: vi.fn() }));

const storedSettings: Settings = {
  theme: 'dark',
  cs2Path: null,
  gsiPort: null,
  autostart: false,
  closeToTray: true,
  autoUpdate: true,
  scoreboardEnabled: true,
  scoreboardLayout: { groups: [{ label: 'Match totals', fields: ['kills'] }] },
  gsiTiming: 'default',
  overlayScoreboardOpacity: 0.7,
  overlayMapOpacity: 0.5,
  overlayCalloutOpacity: 0.25,
  overlayChromeOpacity: 0.4,
};

describe('OverlayControls', () => {
  beforeEach(() => {
    vi.mocked(updateSettings).mockReset().mockResolvedValue(success(storedSettings));
    useSettingsStore.setState({ settings: storedSettings });
  });

  it('renders nothing until the settings snapshot arrives', () => {
    useSettingsStore.setState({ settings: undefined });
    render(<OverlayControls />);

    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('shows one percent slider per element and no switches (ADR-060)', () => {
    render(<OverlayControls />);

    expect(screen.getAllByRole('slider')).toHaveLength(4);
    expect(screen.getByRole('slider', { name: 'Scoreboard opacity' })).toHaveAttribute(
      'aria-valuenow',
      '70',
    );
    expect(screen.getByRole('slider', { name: 'Map opacity' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    );
    expect(screen.getByRole('slider', { name: 'Callouts opacity' })).toHaveAttribute(
      'aria-valuenow',
      '25',
    );
    expect(screen.getByRole('slider', { name: 'Title bar & status opacity' })).toHaveAttribute(
      'aria-valuenow',
      '40',
    );
    expect(screen.getByText('70 %')).toBeInTheDocument();
    expect(screen.getByText('50 %')).toBeInTheDocument();
    expect(screen.getByText('25 %')).toBeInTheDocument();
    expect(screen.getByText('40 %')).toBeInTheDocument();
    // The exemption switches are gone — a switch is a slider pinned to 100 %.
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it.each([
    ['Scoreboard opacity', { overlayScoreboardOpacity: 0.71 }],
    ['Map opacity', { overlayMapOpacity: 0.51 }],
    ['Callouts opacity', { overlayCalloutOpacity: 0.26 }],
    ['Title bar & status opacity', { overlayChromeOpacity: 0.41 }],
  ] as const)(
    'dispatches exactly its own field from the %s slider on a keyboard step (spec AC 4)',
    async (name, payload) => {
      const user = userEvent.setup();
      render(<OverlayControls />);

      const slider = screen.getByRole('slider', { name });
      slider.focus();
      await user.keyboard('{ArrowRight}');

      // Timing-free contract (the OVL.9 pattern): the commit always flushes,
      // and the jsdom rAF (a 16 ms timer) may or may not fire between
      // key-down and key-up — one or two dispatches are both correct, every
      // payload must be the stepped value of this slider's field alone, and
      // more than two would mean broken coalescing.
      const calls = vi.mocked(updateSettings).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls.length).toBeLessThanOrEqual(2);
      for (const call of calls) {
        expect(call[0]).toEqual(payload);
      }
    },
  );
});
