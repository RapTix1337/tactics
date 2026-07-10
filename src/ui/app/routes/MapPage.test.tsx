import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { failure, success } from '../../../shared/envelope';
import type { MapProfileDetails, MapSummary } from '../../../shared/map-catalog';
import {
  createProfile,
  deleteProfile,
  loadMapList,
  loadProfile,
  renameProfile,
  replaceProfileImage,
  setDefaultProfile,
} from '../../lib/ipc/map-catalog';
import { useMapCatalogStore } from '../../stores/map-catalog-store';
import { MapPage } from './MapPage';

vi.mock('../../lib/ipc/map-catalog', () => ({
  createProfile: vi.fn(),
  deleteProfile: vi.fn(),
  loadMapList: vi.fn(),
  loadProfile: vi.fn(),
  renameProfile: vi.fn(),
  replaceProfileImage: vi.fn(),
  setDefaultProfile: vi.fn(),
}));

// The MVP-12 acceptance flows (E22.5): every action round-trips against a
// prepared store — the mocked IPC layer mirrors successes into the store the
// way the real one does (ADR-033), and the page must reflect the returned
// state, never an optimistic one.

const details = (id: string, name: string): MapProfileDetails => ({
  id,
  mapId: 'de_dust2',
  name,
  imageUrl: `tactics-map://de_dust2/${id}.png`,
  callouts: [],
});

const p1 = details('p1', 'Default');
const p2 = details('p2', 'SimpleRadar');

function summaryOf(profiles: readonly MapProfileDetails[], defaultId?: string): MapSummary {
  const resolvedDefault = defaultId ?? profiles[0]?.id;
  return {
    id: 'de_dust2',
    displayName: 'Dust 2',
    profiles: profiles.map(({ id, name, imageUrl }) => ({ id, name, imageUrl })),
    ...(resolvedDefault === undefined ? {} : { defaultProfileId: resolvedDefault }),
  };
}

/**
 * Seeds the catalog store the way the real IPC layer would have — used both
 * to prepare a test and, inside mutation mocks, to mirror a response.
 */
function seedStore(profiles: readonly MapProfileDetails[], defaultId?: string): MapSummary {
  const summary = summaryOf(profiles, defaultId);
  useMapCatalogStore.setState({
    list: [summary],
    profilesById: Object.fromEntries(profiles.map((profile) => [profile.id, profile])),
  });
  return summary;
}

beforeEach(() => {
  vi.mocked(loadMapList).mockReset().mockResolvedValue(success([]));
  vi.mocked(createProfile).mockReset();
  vi.mocked(deleteProfile).mockReset();
  vi.mocked(renameProfile).mockReset();
  vi.mocked(replaceProfileImage).mockReset();
  vi.mocked(setDefaultProfile).mockReset();
  // Resolves like the real loadProfile against the seeded store: the named
  // (or default) profile from the cache, or the named error.
  vi.mocked(loadProfile)
    .mockReset()
    .mockImplementation((mapId, profileId) => {
      const state = useMapCatalogStore.getState();
      const map = state.list?.find((entry) => entry.id === mapId);
      const id = profileId ?? map?.defaultProfileId;
      const profile = id === undefined ? undefined : state.profilesById[id];
      return Promise.resolve(
        profile === undefined
          ? failure('PROFILE_NOT_FOUND', `Map "${mapId}" has no profiles yet.`)
          : success(profile),
      );
    });
  useMapCatalogStore.setState({ list: undefined, profilesById: {} });
});

describe('MapPage', () => {
  it('switches the displayed profile via the switcher (MVP-12)', async () => {
    seedStore([p1, p2]);
    const user = userEvent.setup();
    render(<MapPage mapId="de_dust2" />);
    await screen.findByAltText('Map image (profile "Default")');

    await user.click(screen.getByRole('combobox', { name: 'Profile' }));
    // The default is marked in the switcher.
    expect(await screen.findByRole('option', { name: 'Default (default)' })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'SimpleRadar' }));

    expect(await screen.findByAltText('Map image (profile "SimpleRadar")')).toBeInTheDocument();
    expect(loadProfile).toHaveBeenLastCalledWith('de_dust2', 'p2');
  });

  it('sets the displayed profile as the default and reflects the response', async () => {
    seedStore([p1, p2]);
    vi.mocked(setDefaultProfile).mockImplementation((_mapId, profileId) =>
      Promise.resolve(success(seedStore([p1, p2], profileId))),
    );
    const user = userEvent.setup();
    render(<MapPage mapId="de_dust2" />);
    await screen.findByAltText('Map image (profile "Default")');
    // The displayed profile is the default — nothing to set.
    expect(screen.getByRole('button', { name: 'Set as default' })).toBeDisabled();

    await user.click(screen.getByRole('combobox', { name: 'Profile' }));
    await user.click(await screen.findByRole('option', { name: 'SimpleRadar' }));
    await user.click(screen.getByRole('button', { name: 'Set as default' }));

    expect(setDefaultProfile).toHaveBeenCalledWith('de_dust2', 'p2');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Set as default' })).toBeDisabled();
    });
    expect(screen.getByRole('combobox', { name: 'Profile' })).toHaveTextContent(
      'SimpleRadar (default)',
    );
  });

  it('renames the displayed profile through the rename dialog', async () => {
    seedStore([p1, p2]);
    vi.mocked(renameProfile).mockImplementation((_mapId, _profileId, name) => {
      const renamed = { ...p1, name };
      const map = seedStore([renamed, p2]);
      return Promise.resolve(success({ map, profile: renamed }));
    });
    const user = userEvent.setup();
    render(<MapPage mapId="de_dust2" />);
    await screen.findByAltText('Map image (profile "Default")');

    await user.click(screen.getByRole('button', { name: 'Rename…' }));
    const nameField = await screen.findByLabelText('Profile name');
    expect(nameField).toHaveValue('Default');
    await user.clear(nameField);
    await user.type(nameField, '  Mine  ');
    await user.click(screen.getByRole('button', { name: 'Rename profile' }));

    expect(renameProfile).toHaveBeenCalledWith('de_dust2', 'p1', 'Mine');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('combobox', { name: 'Profile' })).toHaveTextContent('Mine (default)');
  });

  it('creates a fork of an existing profile and displays it (MVP-12)', async () => {
    seedStore([p1, p2]);
    const p3 = details('p3', 'Tweaked');
    vi.mocked(createProfile).mockImplementation(() => {
      const map = seedStore([p1, p2, p3]);
      return Promise.resolve(success({ status: 'created' as const, map, profile: p3 }));
    });
    const user = userEvent.setup();
    render(<MapPage mapId="de_dust2" />);
    await screen.findByAltText('Map image (profile "Default")');

    await user.click(screen.getByRole('button', { name: 'New profile…' }));
    await user.type(await screen.findByLabelText('Profile name'), 'Tweaked');
    await user.click(screen.getByRole('combobox', { name: 'Image source' }));
    await user.click(await screen.findByRole('option', { name: 'Copy of “Default”' }));
    await user.click(screen.getByRole('button', { name: 'Create profile' }));

    expect(createProfile).toHaveBeenCalledWith('de_dust2', 'Tweaked', {
      kind: 'fork',
      profileId: 'p1',
    });
    expect(await screen.findByAltText('Map image (profile "Tweaked")')).toBeInTheDocument();
  });

  it('remounts the map view after a replaced image (same-URL refetch)', async () => {
    const map = seedStore([p1, p2]);
    vi.mocked(replaceProfileImage).mockResolvedValue(
      success({ status: 'replaced', map, profile: p1 }),
    );
    const user = userEvent.setup();
    render(<MapPage mapId="de_dust2" />);
    await screen.findByAltText('Map image (profile "Default")');
    expect(loadProfile).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Replace image…' }));

    expect(replaceProfileImage).toHaveBeenCalledWith('de_dust2', 'p1');
    // The remounted view fetches again — the fresh <img> is the point.
    await waitFor(() => {
      expect(loadProfile).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByAltText('Map image (profile "Default")')).toBeInTheDocument();
  });

  it('falls back to the new default when the displayed profile is deleted', async () => {
    seedStore([p1, p2]);
    vi.mocked(deleteProfile).mockImplementation(() => Promise.resolve(success(seedStore([p2]))));
    const user = userEvent.setup();
    render(<MapPage mapId="de_dust2" />);
    await screen.findByAltText('Map image (profile "Default")');

    await user.click(screen.getByRole('button', { name: 'Delete…' }));
    await user.click(await screen.findByRole('button', { name: 'Delete profile' }));

    expect(deleteProfile).toHaveBeenCalledWith('de_dust2', 'p1');
    expect(await screen.findByAltText('Map image (profile "SimpleRadar")')).toBeInTheDocument();
  });

  it('returns to the empty state when the last profile is deleted (MVP-12)', async () => {
    seedStore([p1]);
    vi.mocked(deleteProfile).mockImplementation(() => Promise.resolve(success(seedStore([]))));
    const user = userEvent.setup();
    render(<MapPage mapId="de_dust2" />);
    await screen.findByAltText('Map image (profile "Default")');

    await user.click(screen.getByRole('button', { name: 'Delete…' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('last profile');
    await user.click(screen.getByRole('button', { name: 'Delete profile' }));

    expect(await screen.findByText('No image yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload image…' })).toBeInTheDocument();
  });

  it('uploads a first profile from the empty state', async () => {
    seedStore([]);
    vi.mocked(createProfile).mockImplementation(() => {
      const map = seedStore([p1]);
      return Promise.resolve(success({ status: 'created' as const, map, profile: p1 }));
    });
    const user = userEvent.setup();
    render(<MapPage mapId="de_dust2" />);

    await user.click(await screen.findByRole('button', { name: 'Upload image…' }));
    // The empty state suggests the overview's one-click name (E22.4).
    expect(await screen.findByLabelText('Profile name')).toHaveValue('Default');
    await user.click(screen.getByRole('button', { name: 'Create profile' }));

    expect(createProfile).toHaveBeenCalledWith('de_dust2', 'Default', { kind: 'upload' });
    expect(await screen.findByAltText('Map image (profile "Default")')).toBeInTheDocument();
  });

  it('shows an unknown-map state when the id is not in the loaded catalog', async () => {
    seedStore([p1]);
    render(<MapPage mapId="de_train" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('This map is not in the catalog.');
  });

  it('shows a retryable error while the map list cannot be loaded', async () => {
    vi.mocked(loadMapList)
      .mockReset()
      .mockResolvedValueOnce(failure('DB_ERROR', 'The local database is unavailable.'))
      .mockImplementationOnce(() => {
        seedStore([p1]);
        return Promise.resolve(success([]));
      });
    const user = userEvent.setup();
    render(<MapPage mapId="de_dust2" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The local database is unavailable.',
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByTestId('map-page-title')).toHaveTextContent('Dust 2');
    expect(await screen.findByAltText('Map image (profile "Default")')).toBeInTheDocument();
  });
});
