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
import { RADAR_IMAGE_HELP_URL } from '../../../shared/external-urls';
import type { MapSummary } from '../../../shared/map-catalog';
import { openExternal } from '../../lib/ipc/external-links';
import { createProfile, loadMapList } from '../../lib/ipc/map-catalog';
import { useMapCatalogStore } from '../../stores/map-catalog-store';
import { MapsOverview } from './MapsOverview';

vi.mock('../../lib/ipc/external-links', () => ({ openExternal: vi.fn() }));

vi.mock('../../lib/ipc/map-catalog', () => ({
  createProfile: vi.fn(),
  loadMapList: vi.fn(),
}));

// The MVP-11 acceptance fixture: the seven Active Duty catalog maps.
const CATALOG = [
  ['de_ancient', 'Ancient'],
  ['de_anubis', 'Anubis'],
  ['de_dust2', 'Dust 2'],
  ['de_inferno', 'Inferno'],
  ['de_mirage', 'Mirage'],
  ['de_nuke', 'Nuke'],
  ['de_overpass', 'Overpass'],
] as const;

function emptyMap(id: string, displayName: string): MapSummary {
  return { id, displayName, profiles: [] };
}

function uploadedMap(id: string, displayName: string): MapSummary {
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

const emptyCatalog: readonly MapSummary[] = CATALOG.map(([id, name]) => emptyMap(id, name));

// The overview's cards render router links, so it needs a routing context.
// This harness pins the overview as the root component over a stub map
// route — navigation itself is covered by src/ui/app/router.test.tsx.
function renderOverview(): void {
  const rootRoute = createRootRoute({ component: (): JSX.Element => <MapsOverview /> });
  const mapRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/maps/$mapId',
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([mapRoute]),
    history: createMemoryHistory({ initialEntries: ['/maps'] }),
  });
  render(<RouterProvider router={router} />);
}

describe('MapsOverview', () => {
  beforeEach(() => {
    vi.mocked(loadMapList)
      .mockReset()
      .mockResolvedValue(success([...emptyCatalog]));
    vi.mocked(createProfile).mockReset();
    vi.mocked(openExternal).mockReset().mockResolvedValue(success(undefined));
    useMapCatalogStore.setState({ list: emptyCatalog, profilesById: {} });
  });

  it('renders all seven catalog maps with their upload state (MVP-11)', async () => {
    const withUpload = emptyCatalog.map((map) =>
      map.id === 'de_dust2' ? uploadedMap(map.id, map.displayName) : map,
    );
    useMapCatalogStore.setState({ list: withUpload });
    renderOverview();

    expect(await screen.findByRole('link', { name: 'View map Dust 2' })).toHaveAttribute(
      'href',
      '/maps/de_dust2',
    );
    expect(screen.getByText('1 profile')).toBeInTheDocument();
    const uploadButtons = screen.getAllByRole('button', { name: /^Upload image… for / });
    expect(uploadButtons).toHaveLength(6);
    expect(
      screen.queryByRole('button', { name: 'Upload image… for Dust 2' }),
    ).not.toBeInTheDocument();
  });

  it('fetches the map list on mount and shows a loading state until it is available', async () => {
    useMapCatalogStore.setState({ list: undefined });
    renderOverview();

    expect(await screen.findByRole('status')).toHaveTextContent('Loading maps…');
    expect(loadMapList).toHaveBeenCalledTimes(1);
  });

  it('shows a retryable error when the list fetch fails', async () => {
    useMapCatalogStore.setState({ list: undefined });
    vi.mocked(loadMapList)
      .mockResolvedValueOnce(failure('DB_ERROR', 'The local database is unavailable.'))
      .mockImplementationOnce(() => {
        // The second fetch succeeds: the real loadMapList mirrors into the
        // store, which this stub reproduces.
        useMapCatalogStore.setState({ list: emptyCatalog });
        return Promise.resolve(success([...emptyCatalog]));
      });
    const user = userEvent.setup();
    renderOverview();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The local database is unavailable.',
    );

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('button', { name: 'Upload image… for Ancient' })).toBeEnabled();
    expect(loadMapList).toHaveBeenCalledTimes(2);
  });

  it('starts the upload flow with the fixed "Default" profile name', async () => {
    vi.mocked(createProfile).mockResolvedValue(success({ status: 'canceled' }));
    const user = userEvent.setup();
    renderOverview();

    await user.click(await screen.findByRole('button', { name: 'Upload image… for Nuke' }));

    expect(createProfile).toHaveBeenCalledWith('de_nuke', 'Default', { kind: 'upload' });
  });

  it('reflects a created profile from the command response (ADR-033)', async () => {
    const nuke = uploadedMap('de_nuke', 'Nuke');
    vi.mocked(createProfile).mockImplementation(() => {
      // The real createProfile mirrors the response into the catalog store;
      // this stub reproduces that seam.
      useMapCatalogStore.setState({
        list: emptyCatalog.map((map) => (map.id === 'de_nuke' ? nuke : map)),
      });
      return Promise.resolve(
        success({
          status: 'created',
          map: nuke,
          profile: {
            id: 'de_nuke-p1',
            mapId: 'de_nuke',
            name: 'Default',
            imageUrl: 'tactics-map://de_nuke/de_nuke-p1.png',
            callouts: [],
          },
        }),
      );
    });
    const user = userEvent.setup();
    renderOverview();

    await user.click(await screen.findByRole('button', { name: 'Upload image… for Nuke' }));

    expect(await screen.findByRole('link', { name: 'View map Nuke' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Upload image… for Nuke' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the card unchanged when the user cancels the file dialog', async () => {
    vi.mocked(createProfile).mockResolvedValue(success({ status: 'canceled' }));
    const user = userEvent.setup();
    renderOverview();

    await user.click(await screen.findByRole('button', { name: 'Upload image… for Nuke' }));

    expect(await screen.findByRole('button', { name: 'Upload image… for Nuke' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the named error at the failing map card', async () => {
    vi.mocked(createProfile).mockResolvedValue(
      failure('IMAGE_INVALID', 'The selected file is not a supported image.'),
    );
    const user = userEvent.setup();
    renderOverview();

    await user.click(await screen.findByRole('button', { name: 'Upload image… for Nuke' }));

    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent('The selected file is not a supported image.');
    expect(screen.getByRole('button', { name: 'Upload image… for Nuke' })).toBeEnabled();
  });

  it('disables every upload affordance while an upload is in flight', async () => {
    let finishUpload: (() => void) | undefined;
    vi.mocked(createProfile).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishUpload = (): void => {
            resolve(success({ status: 'canceled' }));
          };
        }),
    );
    const user = userEvent.setup();
    renderOverview();

    await user.click(await screen.findByRole('button', { name: 'Upload image… for Nuke' }));

    for (const button of screen.getAllByRole('button', { name: /^Upload image… for / })) {
      expect(button).toBeDisabled();
    }
    // The guard above guarantees the mock ran and assigned the resolver.
    finishUpload?.();
    expect(await screen.findByRole('button', { name: 'Upload image… for Nuke' })).toBeEnabled();
  });

  it('shows the onboarding help on first run (no map has an image)', async () => {
    renderOverview();

    expect(await screen.findByRole('heading', { name: 'Get started' })).toBeInTheDocument();
    expect(screen.getByText(/you provide the radar image/)).toBeInTheDocument();
  });

  it('opens the radar-image help via app.openExternal (E15.3)', async () => {
    const user = userEvent.setup();
    renderOverview();

    await user.click(
      await screen.findByRole('button', { name: 'Get a radar image (SimpleRadar)' }),
    );

    expect(openExternal).toHaveBeenCalledWith(RADAR_IMAGE_HELP_URL);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('surfaces a failed help-link open as an alert', async () => {
    vi.mocked(openExternal).mockResolvedValue(
      failure('INTERNAL', 'Could not open the link in the default browser.'),
    );
    const user = userEvent.setup();
    renderOverview();

    await user.click(
      await screen.findByRole('button', { name: 'Get a radar image (SimpleRadar)' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not open the link in the default browser.',
    );
  });

  it('hides the onboarding help once any map has an image', async () => {
    useMapCatalogStore.setState({
      list: emptyCatalog.map((map) =>
        map.id === 'de_dust2' ? uploadedMap(map.id, map.displayName) : map,
      ),
    });
    renderOverview();

    await screen.findByRole('link', { name: 'View map Dust 2' });
    expect(screen.queryByRole('heading', { name: 'Get started' })).not.toBeInTheDocument();
  });
});
