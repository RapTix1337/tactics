import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommandResult } from '../../../shared/envelope';
import { failure, success } from '../../../shared/envelope';
import type { MapSummary } from '../../../shared/map-catalog';
import {
  createProfile,
  deleteProfile,
  renameProfile,
  replaceProfileImage,
  setDefaultProfile,
} from '../../lib/ipc/map-catalog';
import { MapProfileManager } from './MapProfileManager';

vi.mock('../../lib/ipc/map-catalog', () => ({
  createProfile: vi.fn(),
  deleteProfile: vi.fn(),
  renameProfile: vi.fn(),
  replaceProfileImage: vi.fn(),
  setDefaultProfile: vi.fn(),
}));

// The MVP-12 flows themselves are covered at the page level
// (MapPage.test.tsx); these tests pin the manager-internal states — the
// pending slot, inline errors, and the dialog edge cases.

const dust2: MapSummary = {
  id: 'de_dust2',
  displayName: 'Dust 2',
  profiles: [
    { id: 'p1', name: 'Default', imageUrl: 'tactics-map://de_dust2/p1.png' },
    { id: 'p2', name: 'SimpleRadar', imageUrl: 'tactics-map://de_dust2/p2.png' },
  ],
  defaultProfileId: 'p1',
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nativeResolve) => {
    resolve = nativeResolve;
  });
  return { promise, resolve };
}

function renderManager(onImageReplaced = vi.fn()): { onImageReplaced: ReturnType<typeof vi.fn> } {
  render(
    <MapProfileManager
      map={dust2}
      displayedProfileId="p2"
      onSelectProfile={vi.fn()}
      onProfileCreated={vi.fn()}
      onImageReplaced={onImageReplaced}
    />,
  );
  return { onImageReplaced };
}

beforeEach(() => {
  vi.mocked(createProfile).mockReset();
  vi.mocked(deleteProfile).mockReset();
  vi.mocked(renameProfile).mockReset();
  vi.mocked(replaceProfileImage).mockReset();
  vi.mocked(setDefaultProfile).mockReset();
});

describe('MapProfileManager', () => {
  it('disables all actions while a direct action is in flight', async () => {
    const pending = deferred<CommandResult<MapSummary>>();
    vi.mocked(setDefaultProfile).mockReturnValue(pending.promise);
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByRole('button', { name: 'Set as default' }));

    expect(screen.getByRole('combobox', { name: 'Profile' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Replace image…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete…' })).toBeDisabled();

    pending.resolve(success(dust2));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Replace image…' })).toBeEnabled();
    });
  });

  it('shows the named error when a direct action fails', async () => {
    vi.mocked(setDefaultProfile).mockResolvedValue(
      failure('DB_ERROR', 'The local database is unavailable.'),
    );
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByRole('button', { name: 'Set as default' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The local database is unavailable.',
    );
  });

  it('does not remount the view when the replace dialog is canceled', async () => {
    vi.mocked(replaceProfileImage).mockResolvedValue(success({ status: 'canceled' }));
    const user = userEvent.setup();
    const { onImageReplaced } = renderManager();

    await user.click(screen.getByRole('button', { name: 'Replace image…' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Replace image…' })).toBeEnabled();
    });
    expect(onImageReplaced).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the create dialog open when the native upload dialog is canceled', async () => {
    vi.mocked(createProfile).mockResolvedValue(success({ status: 'canceled' }));
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByRole('button', { name: 'New profile…' }));
    await user.type(await screen.findByLabelText('Profile name'), 'Second try');
    await user.click(screen.getByRole('button', { name: 'Create profile' }));

    expect(createProfile).toHaveBeenCalledWith('de_dust2', 'Second try', { kind: 'upload' });
    expect(screen.getByRole('dialog')).toHaveTextContent('New profile for Dust 2');
  });

  it('blocks a blank rename', async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByRole('button', { name: 'Rename…' }));
    await user.clear(await screen.findByLabelText('Profile name'));

    expect(screen.getByRole('button', { name: 'Rename profile' })).toBeDisabled();
    expect(renameProfile).not.toHaveBeenCalled();
  });

  it('shows a failed delete inside the confirmation dialog', async () => {
    vi.mocked(deleteProfile).mockResolvedValue(
      failure('DB_ERROR', 'The local database is unavailable.'),
    );
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByRole('button', { name: 'Delete…' }));
    await user.click(await screen.findByRole('button', { name: 'Delete profile' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('The local database is unavailable.');
    expect(deleteProfile).toHaveBeenCalledWith('de_dust2', 'p2');
  });
});
