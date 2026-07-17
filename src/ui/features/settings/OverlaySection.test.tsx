import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { updateSettings } from '@/lib/ipc/settings';
import { useSettingsStore } from '@/stores/settings-store';

import { success } from '../../../shared/envelope';
import type { Settings } from '../../../shared/settings';
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
  overlayScoreboardOpacity: 1,
  overlayMapOpacity: 1,
  overlayCalloutOpacity: 1,
  overlayChromeOpacity: 1,
};

describe('OverlaySection', () => {
  beforeEach(() => {
    vi.mocked(updateSettings).mockReset().mockResolvedValue(success(storedSettings));
    useSettingsStore.setState({ settings: storedSettings });
  });

  it('renders the heading and the shared four-slider overlay controls (ADR-060)', () => {
    render(<OverlaySection />);

    expect(screen.getByRole('heading', { name: 'Overlay' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Scoreboard opacity' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Map opacity' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Callouts opacity' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Title bar & status opacity' })).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('shows a loading state until the settings snapshot arrives', () => {
    useSettingsStore.setState({ settings: undefined });
    render(<OverlaySection />);

    expect(screen.getByRole('heading', { name: 'Overlay' })).toBeInTheDocument();
    expect(screen.getByText('Loading settings…')).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });
});
