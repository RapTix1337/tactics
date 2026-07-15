import { render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Settings } from '../../../shared/settings';
import { useScoreboardStore } from '../../stores/scoreboard-store';
import { useSettingsStore } from '../../stores/settings-store';
import { SAMPLE_SCOREBOARD_LAYOUT, SAMPLE_SCOREBOARD_STATE } from '../scoreboard/sample-state';
import { OverlayFrame } from './OverlayFrame';

// The map view has its own suite; the frame only places it, so a stub keeps
// these tests on arrangement and fade regions (the LivePage.test.tsx pattern).
vi.mock('../../features/map-view/MapView', () => ({
  MapView: ({ mapId }: { mapId: string }): JSX.Element => (
    <div data-testid="overlay-map-view">{mapId}</div>
  ),
}));

const settingsWithScoreboard: Settings = {
  theme: 'dark',
  cs2Path: null,
  gsiPort: null,
  autostart: false,
  closeToTray: true,
  autoUpdate: true,
  scoreboardEnabled: true,
  scoreboardLayout: SAMPLE_SCOREBOARD_LAYOUT,
  gsiTiming: 'default',
  overlayOpacity: 0.5,
  overlayMapExempt: false,
  overlayScoreboardExempt: false,
};

function renderFrame(onActiveChange = vi.fn()): ReturnType<typeof render> {
  return render(<OverlayFrame mapId="de_dust2" onActiveChange={onActiveChange} />);
}

describe('OverlayFrame', () => {
  beforeEach(() => {
    useScoreboardStore.setState({ scoreboard: SAMPLE_SCOREBOARD_STATE });
    useSettingsStore.setState({ settings: settingsWithScoreboard });
  });

  it('arranges header, cards, and map as sibling fade regions while the scoreboard shows', () => {
    renderFrame();

    // Score header + both cards follow the scoreboard variable…
    expect(screen.getByTestId('overlay-score-header')).toHaveStyle({
      opacity: 'var(--fade-scoreboard)',
    });
    expect(screen.getByTestId('overlay-my-card')).toHaveStyle({
      opacity: 'var(--fade-scoreboard)',
    });
    expect(screen.getByTestId('overlay-enemy-card')).toHaveStyle({
      opacity: 'var(--fade-scoreboard)',
    });
    // …the map cell its own — as siblings, so exemptions can exceed the rest.
    expect(screen.getByTestId('overlay-map-cell')).toHaveStyle({ opacity: 'var(--fade-map)' });
    expect(screen.getByTestId('overlay-map-view')).toHaveTextContent('de_dust2');
  });

  it('renders only the faded map cell while the scoreboard slice is inactive', () => {
    useScoreboardStore.setState({ scoreboard: { active: false } });

    renderFrame();

    expect(screen.getByTestId('overlay-map-cell')).toHaveStyle({ opacity: 'var(--fade-map)' });
    expect(screen.getByTestId('overlay-map-view')).toHaveTextContent('de_dust2');
    expect(screen.queryByTestId('overlay-score-header')).not.toBeInTheDocument();
    expect(screen.queryByTestId('overlay-my-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('overlay-enemy-card')).not.toBeInTheDocument();
  });

  it('renders only the map while the scoreboard is disabled in the settings', () => {
    useSettingsStore.setState({
      settings: { ...settingsWithScoreboard, scoreboardEnabled: false },
    });

    renderFrame();

    expect(screen.getByTestId('overlay-map-view')).toBeInTheDocument();
    expect(screen.queryByTestId('overlay-score-header')).not.toBeInTheDocument();
  });

  it('renders only the map while the settings snapshot is still missing', () => {
    useSettingsStore.setState({ settings: undefined });

    renderFrame();

    expect(screen.getByTestId('overlay-map-view')).toBeInTheDocument();
    expect(screen.queryByTestId('overlay-score-header')).not.toBeInTheDocument();
  });

  it('signals its presence on mount and clears it on unmount (the slot fade hand-over)', () => {
    const onActiveChange = vi.fn();

    const { unmount } = renderFrame(onActiveChange);
    expect(onActiveChange).toHaveBeenLastCalledWith(true);

    unmount();
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
  });
});
