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
  overlayOpacity: 0.7,
  overlayMapExempt: false,
  overlayScoreboardExempt: true,
};

describe('OverlayControls', () => {
  beforeEach(() => {
    vi.mocked(updateSettings).mockReset().mockResolvedValue(success(storedSettings));
    useSettingsStore.setState({ settings: storedSettings });
  });

  it('renders nothing until the settings snapshot arrives', () => {
    useSettingsStore.setState({ settings: undefined });
    render(<OverlayControls />);

    expect(screen.queryByRole('slider', { name: 'Overlay opacity' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('shows the persisted opacity as a percentage', () => {
    render(<OverlayControls />);

    expect(screen.getByRole('slider', { name: 'Overlay opacity' })).toHaveAttribute(
      'aria-valuenow',
      '70',
    );
    expect(screen.getByText('70 %')).toBeInTheDocument();
  });

  it('dispatches settings.update with the 0–1 opacity on a keyboard step (spec AC 4)', async () => {
    const user = userEvent.setup();
    render(<OverlayControls />);

    const slider = screen.getByRole('slider', { name: 'Overlay opacity' });
    slider.focus();
    await user.keyboard('{ArrowRight}');

    expect(updateSettings).toHaveBeenCalledWith({ overlayOpacity: 0.71 });
    // Change + commit of the same interaction coalesce into one dispatch.
    expect(updateSettings).toHaveBeenCalledTimes(1);
  });

  it('dispatches the map exemption switch (spec AC 5)', async () => {
    const user = userEvent.setup();
    render(<OverlayControls />);

    const mapSwitch = screen.getByRole('switch', { name: 'Map always opaque' });
    expect(mapSwitch).not.toBeChecked();

    await user.click(mapSwitch);

    expect(updateSettings).toHaveBeenCalledWith({ overlayMapExempt: true });
    // No optimistic UI (ADR-033): the switch follows evt:settings.changed.
    expect(mapSwitch).not.toBeChecked();
  });

  it('dispatches the scoreboard exemption switch (spec AC 5)', async () => {
    const user = userEvent.setup();
    render(<OverlayControls />);

    const scoreboardSwitch = screen.getByRole('switch', { name: 'Scoreboard always opaque' });
    expect(scoreboardSwitch).toBeChecked();

    await user.click(scoreboardSwitch);

    expect(updateSettings).toHaveBeenCalledWith({ overlayScoreboardExempt: false });
  });
});
