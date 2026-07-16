import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { success } from '../../../shared/envelope';
import type { Settings } from '../../../shared/settings';
import { updateSettings } from '../../lib/ipc/settings';
import { useSettingsStore } from '../../stores/settings-store';
import { OverlaySection } from './OverlaySection';

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
  overlayOpacity: 1,
  overlayMapExempt: false,
  overlayScoreboardExempt: false,
};

describe('OverlaySection', () => {
  beforeEach(() => {
    vi.mocked(updateSettings).mockReset().mockResolvedValue(success(storedSettings));
    useSettingsStore.setState({ settings: storedSettings });
  });

  it('renders the heading and the shared overlay controls', () => {
    render(<OverlaySection />);

    expect(screen.getByRole('heading', { name: 'Overlay' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Overlay opacity' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Map always opaque' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Scoreboard always opaque' })).toBeInTheDocument();
  });

  it('shows a loading state until the settings snapshot arrives', () => {
    useSettingsStore.setState({ settings: undefined });
    render(<OverlaySection />);

    expect(screen.getByRole('heading', { name: 'Overlay' })).toBeInTheDocument();
    expect(screen.getByText('Loading settings…')).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });
});
