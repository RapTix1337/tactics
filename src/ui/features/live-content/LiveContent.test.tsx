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
import type { GameStateMap, GsiConnectionStatus } from '../../../shared/game-state';
import type { MapSummary } from '../../../shared/map-catalog';
import { openExternal } from '../../lib/ipc/external-links';
import { loadMapList } from '../../lib/ipc/map-catalog';
import { useMapCatalogStore } from '../../stores/map-catalog-store';
import { LiveContent } from './LiveContent';

vi.mock('../../lib/ipc/external-links', () => ({ openExternal: vi.fn() }));
vi.mock('../../lib/ipc/map-catalog', () => ({ loadMapList: vi.fn() }));

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
const emptyNuke: MapSummary = { id: 'de_nuke', displayName: 'Nuke', profiles: [] };

const resolvedDust2: GameStateMap = { kind: 'resolved', mapId: 'de_dust2' };
const resolvedNuke: GameStateMap = { kind: 'resolved', mapId: 'de_nuke' };
const unsupportedMap: GameStateMap = { kind: 'unsupported', rawName: 'de_communitymap' };

function renderMapStub(mapId: string): JSX.Element {
  return <div data-testid="rendered-map">{mapId}</div>;
}

interface RenderOptions {
  readonly status?: GsiConnectionStatus;
  readonly map: GameStateMap;
  readonly interactive: boolean;
}

// The interactive upload-needed state renders a router link, so the
// interactive variant gets a routing context (the LivePage.test.tsx harness
// pattern); the non-interactive variant renders router-free — exactly the
// overlay window's situation.
function renderLiveContent({ status = 'connected', map, interactive }: RenderOptions): void {
  const content = (): JSX.Element => (
    <LiveContent status={status} map={map} interactive={interactive} renderMap={renderMapStub} />
  );
  if (!interactive) {
    render(content());
    return;
  }
  const rootRoute = createRootRoute({ component: content });
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

describe('LiveContent', () => {
  beforeEach(() => {
    vi.mocked(openExternal).mockReset().mockResolvedValue(success(undefined));
    vi.mocked(loadMapList)
      .mockReset()
      .mockResolvedValue(success([dust2, emptyNuke]));
    useMapCatalogStore.setState({ list: [dust2, emptyNuke], profilesById: {} });
  });

  describe('resolved map with a profile', () => {
    it.each([{ interactive: true }, { interactive: false }])(
      'renders the map via renderMap (interactive: $interactive)',
      async ({ interactive }) => {
        renderLiveContent({ map: resolvedDust2, interactive });

        expect(await screen.findByTestId('rendered-map')).toHaveTextContent('de_dust2');
      },
    );
  });

  describe('resolved map without a profile (upload-needed)', () => {
    it('links into the upload flow in the interactive variant (MVP-09)', async () => {
      renderLiveContent({ map: resolvedNuke, interactive: true });

      expect(await screen.findByText(/has no radar image yet/)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Upload image…' })).toHaveAttribute(
        'href',
        '/maps/de_nuke',
      );
      expect(screen.queryByTestId('rendered-map')).not.toBeInTheDocument();
    });

    it('renders the informational text without the link in the non-interactive variant', async () => {
      renderLiveContent({ map: resolvedNuke, interactive: false });

      expect(await screen.findByText(/has no radar image yet/)).toBeInTheDocument();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rendered-map')).not.toBeInTheDocument();
    });
  });

  describe('map list states', () => {
    it('shows a retryable failure in the interactive variant', async () => {
      useMapCatalogStore.setState({ list: undefined, profilesById: {} });
      vi.mocked(loadMapList)
        .mockReset()
        .mockResolvedValueOnce(failure('DB_ERROR', 'The local database is unavailable.'))
        .mockImplementationOnce(() => {
          // The real loadMapList mirrors into the store; the stub reproduces it.
          useMapCatalogStore.setState({ list: [dust2, emptyNuke] });
          return Promise.resolve(success([dust2, emptyNuke]));
        });
      const user = userEvent.setup();
      renderLiveContent({ map: resolvedDust2, interactive: true });

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'The local database is unavailable.',
      );

      await user.click(screen.getByRole('button', { name: 'Try again' }));

      expect(await screen.findByTestId('rendered-map')).toHaveTextContent('de_dust2');
    });

    it('shows the failure without a retry button in the non-interactive variant', async () => {
      useMapCatalogStore.setState({ list: undefined, profilesById: {} });
      vi.mocked(loadMapList)
        .mockReset()
        .mockResolvedValue(failure('DB_ERROR', 'The local database is unavailable.'));
      renderLiveContent({ map: resolvedDust2, interactive: false });

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'The local database is unavailable.',
      );
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    });

    it('flags a resolved map missing from the loaded list as out of sync', async () => {
      renderLiveContent({
        map: { kind: 'resolved', mapId: 'de_inferno' },
        interactive: false,
      });

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'The detected map is not in the loaded map list.',
      );
    });

    it('shows a loading state while the list fetch is pending', async () => {
      useMapCatalogStore.setState({ list: undefined, profilesById: {} });
      vi.mocked(loadMapList)
        .mockReset()
        .mockImplementation(() => new Promise(() => {}));
      renderLiveContent({ map: resolvedDust2, interactive: false });

      expect(await screen.findByRole('status')).toHaveTextContent('Loading maps…');
    });
  });

  describe('unsupported map', () => {
    it('shows the detected raw name in both variants', async () => {
      renderLiveContent({ map: unsupportedMap, interactive: false });

      expect(await screen.findByText('Unsupported map')).toBeInTheDocument();
      expect(screen.getByText('de_communitymap')).toBeInTheDocument();
    });

    it('opens the project repository via app.openExternal in the interactive variant', async () => {
      const user = userEvent.setup();
      renderLiveContent({ map: unsupportedMap, interactive: true });

      await user.click(await screen.findByRole('button', { name: 'Open project repository' }));

      expect(openExternal).toHaveBeenCalledWith(PROJECT_REPOSITORY_URL);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('surfaces an open-link failure as an alert', async () => {
      vi.mocked(openExternal).mockResolvedValue(
        failure('INTERNAL', 'Could not open the link in the default browser.'),
      );
      const user = userEvent.setup();
      renderLiveContent({ map: unsupportedMap, interactive: true });

      await user.click(await screen.findByRole('button', { name: 'Open project repository' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Could not open the link in the default browser.',
      );
    });

    it('renders the informational text without the button in the non-interactive variant', async () => {
      renderLiveContent({ map: unsupportedMap, interactive: false });

      expect(await screen.findByText('Unsupported map')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Open project repository' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('no game', () => {
    it('shows the GSI diagnostics for a waiting status (GSI-05)', async () => {
      renderLiveContent({ status: 'waiting', map: { kind: 'none' }, interactive: false });

      expect(await screen.findByText('No game detected')).toBeInTheDocument();
      expect(screen.getByText(/No data received — is CS2 running\?/)).toBeInTheDocument();
    });

    it('explains the in-menus case instead of the connected diagnostic', async () => {
      renderLiveContent({ status: 'connected', map: { kind: 'none' }, interactive: false });

      expect(await screen.findByText(/no map is active/)).toBeInTheDocument();
    });
  });
});
