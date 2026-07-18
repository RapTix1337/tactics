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
  overlayScoreboardOpacity: 0.4,
  overlayMapOpacity: 0.6,
  overlayCalloutOpacity: 0.2,
  overlayChromeOpacity: 0.8,
};

const liveOnDust2: GameState = {
  status: 'connected',
  map: { kind: 'resolved', mapId: 'de_dust2' },
};

function setSettings(overrides: Partial<Settings>): void {
  useSettingsStore.setState({ settings: { ...baseSettings, ...overrides } });
}

function fadeVariables(): { scoreboard: string; map: string; callouts: string; chrome: string } {
  const root = screen.getByTestId('overlay-root');
  return {
    scoreboard: root.style.getPropertyValue('--fade-scoreboard'),
    map: root.style.getPropertyValue('--fade-map'),
    callouts: root.style.getPropertyValue('--fade-callouts'),
    chrome: root.style.getPropertyValue('--fade-chrome'),
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

  // Unlike the live page, every non-map overlay state collapses to one black
  // idle placeholder (live-overlay enhancement, ADR-062) — the overlay never
  // shows diagnostic text over the game.
  describe('idle placeholder (all non-map states)', () => {
    it('shows the placeholder with chrome before the first game-state slice', () => {
      render(<OverlayRoot />);

      expect(screen.getByTestId('overlay-idle-placeholder')).toBeInTheDocument();
      expect(screen.getByText('Waiting for match…')).toBeInTheDocument();
      expect(screen.queryByText('Waiting for game state…')).not.toBeInTheDocument();
      expect(screen.getByTestId('overlay-chrome')).toBeInTheDocument();
    });

    it('shows the placeholder instead of the no-game diagnostics in the menu', () => {
      useGameStateStore.setState({
        gameState: { status: 'connected', map: { kind: 'none' } },
      });

      render(<OverlayRoot />);

      expect(screen.getByTestId('overlay-idle-placeholder')).toBeInTheDocument();
      expect(screen.queryByText('No game detected')).not.toBeInTheDocument();
    });

    it('shows the placeholder instead of the unsupported-map state', () => {
      useGameStateStore.setState({
        gameState: { status: 'connected', map: { kind: 'unsupported', rawName: 'de_custom' } },
      });

      render(<OverlayRoot />);

      expect(screen.getByTestId('overlay-idle-placeholder')).toBeInTheDocument();
      expect(screen.queryByText('Unsupported map')).not.toBeInTheDocument();
    });

    it('shows the placeholder instead of the upload hint', async () => {
      useGameStateStore.setState({
        gameState: { status: 'connected', map: { kind: 'resolved', mapId: 'de_nuke' } },
      });

      render(<OverlayRoot />);

      expect(await screen.findByTestId('overlay-idle-placeholder')).toBeInTheDocument();
      expect(screen.queryByText(/has no radar image yet/)).not.toBeInTheDocument();
    });
  });

  describe('resolved map', () => {
    it('renders the overlay frame for a resolved map with a profile', async () => {
      useGameStateStore.setState({ gameState: liveOnDust2 });
      useScoreboardStore.setState({ scoreboard: SAMPLE_SCOREBOARD_STATE });

      render(<OverlayRoot />);

      expect(await screen.findByTestId('overlay-map-view')).toHaveTextContent('de_dust2');
      expect(screen.getByTestId('overlay-score-header')).toBeInTheDocument();
    });
  });

  describe('fade variables (spec AC 4/5, ADR-060)', () => {
    it('feeds each slider value to exactly its own variable — no coupling', () => {
      render(<OverlayRoot />);

      expect(fadeVariables()).toEqual({
        scoreboard: '0.4',
        map: '0.6',
        callouts: '0.2',
        chrome: '0.8',
      });
    });

    it('moves one slider without touching the other three', () => {
      setSettings({ overlayMapOpacity: 0 });

      render(<OverlayRoot />);

      expect(fadeVariables()).toEqual({
        scoreboard: '0.4',
        map: '0',
        callouts: '0.2',
        chrome: '0.8',
      });
    });

    it('defaults every variable to 1 before the settings snapshot arrives', () => {
      useSettingsStore.setState({ settings: undefined });

      render(<OverlayRoot />);

      expect(fadeVariables()).toEqual({ scoreboard: '1', map: '1', callouts: '1', chrome: '1' });
    });

    it('applies settings changes live via the settings mirror (evt:settings.changed)', () => {
      render(<OverlayRoot />);
      expect(fadeVariables().chrome).toBe('0.8');

      act(() => {
        setSettings({ overlayChromeOpacity: 0.1, overlayCalloutOpacity: 1 });
      });

      expect(fadeVariables()).toEqual({
        scoreboard: '0.4',
        map: '0.6',
        callouts: '1',
        chrome: '0.1',
      });
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
    // The idle placeholder stands in for the map, so it follows the map slider
    // — not chrome (ADR-062). Chrome is kept low for see-through title bars;
    // coupling the placeholder to it made an activated overlay vanish in the
    // menu (the reported bug).
    it('fades the idle placeholder with the map variable, not chrome', () => {
      render(<OverlayRoot />);

      expect(screen.getByTestId('overlay-content')).toHaveStyle({
        opacity: 'var(--fade-map)',
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
        opacity: 'var(--fade-map)',
      });
    });
  });
});
