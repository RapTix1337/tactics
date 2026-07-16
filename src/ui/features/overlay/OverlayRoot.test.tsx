import { act, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { success } from '../../../shared/envelope';
import type { GameState } from '../../../shared/game-state';
import type { MapSummary } from '../../../shared/map-catalog';
import { OVERLAY_RESIZE_EDGES } from '../../../shared/overlay-state';
import type { Settings } from '../../../shared/settings';
import { loadMapList } from '../../lib/ipc/map-catalog';
import { useGameStateStore } from '../../stores/game-state-store';
import { useMapCatalogStore } from '../../stores/map-catalog-store';
import { useScoreboardStore } from '../../stores/scoreboard-store';
import { useSettingsStore } from '../../stores/settings-store';
import { SAMPLE_SCOREBOARD_LAYOUT, SAMPLE_SCOREBOARD_STATE } from '../scoreboard/sample-state';
import { OverlayRoot } from './OverlayRoot';

vi.mock('../../lib/ipc/overlay', () => ({ closeOverlay: vi.fn(), resizeOverlay: vi.fn() }));
vi.mock('../../lib/ipc/map-catalog', () => ({ loadMapList: vi.fn() }));
vi.mock('../../features/map-view/MapView', () => ({
  MapView: ({ mapId }: { mapId: string }): JSX.Element => (
    <div data-testid="overlay-map-view">{mapId}</div>
  ),
}));

const dust2: MapSummary = {
  id: 'de_dust2',
  displayName: 'Dust 2',
  profiles: [
    { id: 'de_dust2-p1', name: 'Default', imageUrl: 'tactics-map://de_dust2/de_dust2-p1.png' },
  ],
  defaultProfileId: 'de_dust2-p1',
};
const emptyNuke: MapSummary = { id: 'de_nuke', displayName: 'Nuke', profiles: [] };

const baseSettings: Settings = {
  theme: 'dark',
  cs2Path: null,
  gsiPort: null,
  autostart: false,
  closeToTray: true,
  autoUpdate: true,
  scoreboardEnabled: true,
  scoreboardLayout: SAMPLE_SCOREBOARD_LAYOUT,
  gsiTiming: 'default',
  overlayOpacity: 0.4,
  overlayMapExempt: false,
  overlayScoreboardExempt: false,
};

const liveOnDust2: GameState = {
  status: 'connected',
  map: { kind: 'resolved', mapId: 'de_dust2' },
};

function setSettings(overrides: Partial<Settings>): void {
  useSettingsStore.setState({ settings: { ...baseSettings, ...overrides } });
}

function fadeVariables(): { base: string; map: string; scoreboard: string } {
  const root = screen.getByTestId('overlay-root');
  return {
    base: root.style.getPropertyValue('--fade-base'),
    map: root.style.getPropertyValue('--fade-map'),
    scoreboard: root.style.getPropertyValue('--fade-scoreboard'),
  };
}

describe('OverlayRoot', () => {
  beforeEach(() => {
    vi.mocked(loadMapList)
      .mockReset()
      .mockResolvedValue(success([dust2, emptyNuke]));
    useGameStateStore.setState({ gameState: undefined });
    useScoreboardStore.setState({ scoreboard: undefined });
    useMapCatalogStore.setState({ list: [dust2, emptyNuke], profilesById: {} });
    setSettings({});
  });

  describe('state matrix (mirrors the live page)', () => {
    it('shows the waiting state with chrome before the first game-state slice', () => {
      render(<OverlayRoot />);

      expect(screen.getByText('Waiting for game state…')).toBeInTheDocument();
      expect(screen.getByTestId('overlay-chrome')).toBeInTheDocument();
    });

    it('shows the no-game diagnostics without a live map', () => {
      useGameStateStore.setState({
        gameState: { status: 'connected', map: { kind: 'none' } },
      });

      render(<OverlayRoot />);

      expect(screen.getByText('No game detected')).toBeInTheDocument();
    });

    it('shows the unsupported-map state without the repository button (non-interactive)', () => {
      useGameStateStore.setState({
        gameState: { status: 'connected', map: { kind: 'unsupported', rawName: 'de_custom' } },
      });

      render(<OverlayRoot />);

      expect(screen.getByText('Unsupported map')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Open project repository' }),
      ).not.toBeInTheDocument();
    });

    it('shows the upload hint without the router link (non-interactive)', async () => {
      useGameStateStore.setState({
        gameState: { status: 'connected', map: { kind: 'resolved', mapId: 'de_nuke' } },
      });

      render(<OverlayRoot />);

      expect(await screen.findByText(/has no radar image yet/)).toBeInTheDocument();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('renders the overlay frame for a resolved map with a profile', async () => {
      useGameStateStore.setState({ gameState: liveOnDust2 });
      useScoreboardStore.setState({ scoreboard: SAMPLE_SCOREBOARD_STATE });

      render(<OverlayRoot />);

      expect(await screen.findByTestId('overlay-map-view')).toHaveTextContent('de_dust2');
      expect(screen.getByTestId('overlay-score-header')).toBeInTheDocument();
    });
  });

  describe('fade variables (spec AC 4/5)', () => {
    it('feeds the slider value to all three regions without exemptions', () => {
      render(<OverlayRoot />);

      expect(fadeVariables()).toEqual({ base: '0.4', map: '0.4', scoreboard: '0.4' });
    });

    it('pins the map region to 1 while the others follow the slider', () => {
      setSettings({ overlayMapExempt: true });

      render(<OverlayRoot />);

      expect(fadeVariables()).toEqual({ base: '0.4', map: '1', scoreboard: '0.4' });
    });

    it('pins the scoreboard region to 1 while the others follow the slider', () => {
      setSettings({ overlayScoreboardExempt: true });

      render(<OverlayRoot />);

      expect(fadeVariables()).toEqual({ base: '0.4', map: '0.4', scoreboard: '1' });
    });

    it('pins both exempted regions at once', () => {
      setSettings({ overlayMapExempt: true, overlayScoreboardExempt: true });

      render(<OverlayRoot />);

      expect(fadeVariables()).toEqual({ base: '0.4', map: '1', scoreboard: '1' });
    });

    it('defaults every region to 1 before the settings snapshot arrives', () => {
      useSettingsStore.setState({ settings: undefined });

      render(<OverlayRoot />);

      expect(fadeVariables()).toEqual({ base: '1', map: '1', scoreboard: '1' });
    });

    it('applies settings changes live via the settings mirror (evt:settings.changed)', () => {
      render(<OverlayRoot />);
      expect(fadeVariables().base).toBe('0.4');

      act(() => {
        setSettings({ overlayOpacity: 0.8, overlayMapExempt: true });
      });

      expect(fadeVariables()).toEqual({ base: '0.8', map: '1', scoreboard: '0.8' });
    });
  });

  describe('resize handles (spec AC 6)', () => {
    it('mounts all 8 handles alongside chrome and content', () => {
      render(<OverlayRoot />);

      for (const edge of OVERLAY_RESIZE_EDGES) {
        expect(screen.getByTestId(`resize-handle-${edge}`)).toBeInTheDocument();
      }
    });
  });

  describe('slot fade hand-over (sibling-region invariant)', () => {
    it('fades the content slot with the base variable while a fallback state shows', () => {
      render(<OverlayRoot />);

      expect(screen.getByTestId('overlay-content')).toHaveStyle({
        opacity: 'var(--fade-base)',
      });
    });

    it('lifts the slot fade while the frame owns the per-region fading', async () => {
      useGameStateStore.setState({ gameState: liveOnDust2 });

      render(<OverlayRoot />);

      await screen.findByTestId('overlay-map-view');
      expect(screen.getByTestId('overlay-content').style.opacity).toBe('');
    });

    it('restores the slot fade when the frame unmounts (map back to none)', async () => {
      useGameStateStore.setState({ gameState: liveOnDust2 });
      render(<OverlayRoot />);
      await screen.findByTestId('overlay-map-view');

      act(() => {
        useGameStateStore.setState({
          gameState: { status: 'connected', map: { kind: 'none' } },
        });
      });

      expect(screen.getByTestId('overlay-content')).toHaveStyle({
        opacity: 'var(--fade-base)',
      });
    });
  });
});
