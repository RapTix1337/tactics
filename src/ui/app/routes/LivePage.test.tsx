import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { failure, success } from '../../../shared/envelope';
import { PROJECT_REPOSITORY_URL } from '../../../shared/external-urls';
import type { MapSummary } from '../../../shared/map-catalog';
import { openExternal } from '../../lib/ipc/external-links';
import { loadMapList } from '../../lib/ipc/map-catalog';
import { useAppStore } from '../../stores/app-store';
import { useGameStateStore } from '../../stores/game-state-store';
import { useMapCatalogStore } from '../../stores/map-catalog-store';
import { LivePage } from './LivePage';

vi.mock('../../lib/ipc/external-links', () => ({ openExternal: vi.fn() }));
vi.mock('../../lib/ipc/map-catalog', () => ({ loadMapList: vi.fn() }));

// The map view has its own suite (MapView.test.tsx); the live page only
// selects it, so a stub keeps these tests on the state selection.
vi.mock('../../features/map-view/MapView', () => ({
  MapView: ({ mapId }: { mapId: string }): JSX.Element => (
    <div data-testid="live-map-view">{mapId}</div>
  ),
}));

function mapWithProfile(id: string, displayName: string): MapSummary {
  const profileId = `${id}-p1`;
  return {
    id,
    displayName,
    profiles: [
      { id: profileId, name: 'Default', imageUrl: `tactics-map://${id}/${profileId}.png` },
    ],
    defaultProfileId: profileId,
  };
}

const dust2 = mapWithProfile('de_dust2', 'Dust 2');
const mirage = mapWithProfile('de_mirage', 'Mirage');
const emptyNuke: MapSummary = { id: 'de_nuke', displayName: 'Nuke', profiles: [] };

// The upload hint renders a router link, so the page needs a routing
// context (the MapsOverview.test.tsx harness pattern); navigation itself is
// covered by router.test.tsx.
function renderLivePage(): void {
  const rootRoute = createRootRoute({ component: (): JSX.Element => <LivePage /> });
  const mapRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/maps/$mapId',
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([mapRoute]),
    history: createMemoryHistory({ initialEntries: ['/live'] }),
  });
  render(<RouterProvider router={router} />);
}

describe('LivePage', () => {
  beforeEach(() => {
    vi.mocked(openExternal).mockReset().mockResolvedValue(success(undefined));
    vi.mocked(loadMapList)
      .mockReset()
      .mockResolvedValue(success([dust2, mirage, emptyNuke]));
    useAppStore.setState({ ipcStatus: 'ready', lastError: undefined });
    useGameStateStore.setState({ gameState: undefined });
    useMapCatalogStore.setState({ list: [dust2, mirage, emptyNuke], profilesById: {} });
  });

  it('keeps the heading and the stable ipc-status selector in every state (E5.4)', async () => {
    renderLivePage();

    expect(await screen.findByRole('heading', { name: 'Live' })).toBeInTheDocument();
    expect(screen.getByTestId('ipc-status')).toHaveTextContent('IPC: ready');
  });

  it('shows a waiting state until the snapshot fills the store', async () => {
    renderLivePage();

    expect(await screen.findByRole('status')).toHaveTextContent('Waiting for game state…');
  });

  it('renders the map view for a resolved map with a profile (MVP-05)', async () => {
    useGameStateStore.setState({
      gameState: { status: 'connected', map: { kind: 'resolved', mapId: 'de_dust2' } },
    });
    renderLivePage();

    expect(await screen.findByTestId('live-map-view')).toHaveTextContent('de_dust2');
  });

  it('switches the view when the live map changes', async () => {
    useGameStateStore.setState({
      gameState: { status: 'connected', map: { kind: 'resolved', mapId: 'de_dust2' } },
    });
    renderLivePage();
    expect(await screen.findByTestId('live-map-view')).toHaveTextContent('de_dust2');

    useGameStateStore.setState({
      gameState: { status: 'connected', map: { kind: 'resolved', mapId: 'de_mirage' } },
    });

    expect(await screen.findByTestId('live-map-view')).toHaveTextContent('de_mirage');
  });

  it('links a resolved map without a profile into the upload flow (MVP-09)', async () => {
    useGameStateStore.setState({
      gameState: { status: 'connected', map: { kind: 'resolved', mapId: 'de_nuke' } },
    });
    renderLivePage();

    expect(await screen.findByText(/has no radar image yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upload image…' })).toHaveAttribute(
      'href',
      '/maps/de_nuke',
    );
    expect(screen.queryByTestId('live-map-view')).not.toBeInTheDocument();
  });

  it('shows a retryable failure when the map list cannot be loaded for a resolved map', async () => {
    useMapCatalogStore.setState({ list: undefined, profilesById: {} });
    useGameStateStore.setState({
      gameState: { status: 'connected', map: { kind: 'resolved', mapId: 'de_dust2' } },
    });
    vi.mocked(loadMapList)
      .mockReset()
      .mockResolvedValueOnce(failure('DB_ERROR', 'The local database is unavailable.'))
      .mockImplementationOnce(() => {
        // The real loadMapList mirrors into the store; the stub reproduces it.
        useMapCatalogStore.setState({ list: [dust2, mirage, emptyNuke] });
        return Promise.resolve(success([dust2, mirage, emptyNuke]));
      });
    const user = userEvent.setup();
    renderLivePage();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The local database is unavailable.',
    );

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByTestId('live-map-view')).toHaveTextContent('de_dust2');
  });

  it('shows the detected raw name for an unsupported map (MVP-09)', async () => {
    useGameStateStore.setState({
      gameState: { status: 'connected', map: { kind: 'unsupported', rawName: 'de_communitymap' } },
    });
    renderLivePage();

    expect(await screen.findByText('Unsupported map')).toBeInTheDocument();
    expect(screen.getByText('de_communitymap')).toBeInTheDocument();
  });

  it('opens the project repository via app.openExternal from the unsupported state', async () => {
    useGameStateStore.setState({
      gameState: { status: 'connected', map: { kind: 'unsupported', rawName: 'de_communitymap' } },
    });
    const user = userEvent.setup();
    renderLivePage();

    await user.click(await screen.findByRole('button', { name: 'Open project repository' }));

    expect(openExternal).toHaveBeenCalledWith(PROJECT_REPOSITORY_URL);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('surfaces an open-link failure as an alert', async () => {
    vi.mocked(openExternal).mockResolvedValue(
      failure('INTERNAL', 'Could not open the link in the default browser.'),
    );
    useGameStateStore.setState({
      gameState: { status: 'connected', map: { kind: 'unsupported', rawName: 'de_communitymap' } },
    });
    const user = userEvent.setup();
    renderLivePage();

    await user.click(await screen.findByRole('button', { name: 'Open project repository' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not open the link in the default browser.',
    );
  });

  it('shows the no-game state with the GSI diagnostics (GSI-05)', async () => {
    useGameStateStore.setState({
      gameState: { status: 'waiting', map: { kind: 'none' } },
    });
    renderLivePage();

    expect(await screen.findByText('No game detected')).toBeInTheDocument();
    expect(screen.getByText(/No data received — is CS2 running\?/)).toBeInTheDocument();
  });

  it('explains the in-menus case instead of the connected diagnostic', async () => {
    useGameStateStore.setState({
      gameState: { status: 'connected', map: { kind: 'none' } },
    });
    renderLivePage();

    expect(await screen.findByText(/no map is active/)).toBeInTheDocument();
  });
});
