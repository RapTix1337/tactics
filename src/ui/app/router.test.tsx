import { RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { failure, success } from '../../shared/envelope';
import type { MapSummary } from '../../shared/map-catalog';
import type { ErrorReporter } from '../lib/errors/error-reporting';
import { loadMapList, loadProfile } from '../lib/ipc/map-catalog';
import { useAppStore } from '../stores/app-store';
import { useGameStateStore } from '../stores/game-state-store';
import { useMapCatalogStore } from '../stores/map-catalog-store';
import { createAppRouter } from './router';

vi.mock('../lib/ipc/map-catalog', () => ({
  createProfile: vi.fn(),
  deleteProfile: vi.fn(),
  loadMapList: vi.fn(),
  loadProfile: vi.fn(),
  renameProfile: vi.fn(),
  replaceProfileImage: vi.fn(),
  setDefaultProfile: vi.fn(),
}));

// The error-boundary tests need a page that throws on render; the settings
// skeleton is the most disposable stand-in. `settingsThrows` keeps the
// mock inert for every other test.
let settingsThrows = false;

vi.mock('./routes/SettingsPage', () => ({
  SettingsPage: (): JSX.Element => {
    if (settingsThrows) {
      throw new Error('settings page exploded');
    }
    return <h1>Settings</h1>;
  },
}));

// With an image, so the sidebar entry keeps the plain "Dust 2" accessible
// name (the no-image hint would append to it, E22.4).
const dust2: MapSummary = {
  id: 'de_dust2',
  displayName: 'Dust 2',
  profiles: [{ id: 'p1', name: 'Default', imageUrl: 'tactics-map://de_dust2/p1.png' }],
  defaultProfileId: 'p1',
};

function renderApp(): { report: ReturnType<typeof vi.fn> } {
  const report = vi.fn();
  const router = createAppRouter(report as ErrorReporter);
  render(<RouterProvider router={router} />);
  return { report };
}

describe('createAppRouter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    settingsThrows = false;
    vi.mocked(loadMapList).mockReset().mockResolvedValue(success([]));
    // The map page's MapView fetches on mount; the routing tests only need
    // a settled state, its render states are covered in MapView.test.tsx.
    vi.mocked(loadProfile)
      .mockReset()
      .mockResolvedValue(failure('PROFILE_NOT_FOUND', 'Map "de_dust2" has no profiles yet.'));
    useAppStore.setState({ ipcStatus: 'connecting', lastError: undefined });
    useGameStateStore.setState({ gameState: undefined });
    useMapCatalogStore.setState({ list: [dust2], profilesById: {} });
  });

  it('shows the GSI status badge in the app shell (GSI-05)', async () => {
    useGameStateStore.setState({ gameState: { status: 'waiting', map: { kind: 'none' } } });
    renderApp();

    await screen.findByRole('link', { name: 'Live' });
    expect(screen.getByRole('status', { name: 'GSI connection status' })).toHaveTextContent(
      'Waiting for data',
    );
  });

  it('redirects / to /maps and renders the maps overview as the app home (MVP-11)', async () => {
    renderApp();

    expect(await screen.findByRole('heading', { name: 'Maps' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All maps' })).toHaveAttribute('aria-current', 'page');
  });

  it('reaches the live page with the ipc-status selector via the sidebar entry', async () => {
    useAppStore.setState({ ipcStatus: 'ready', lastError: undefined });
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole('link', { name: 'Live' }));

    expect(await screen.findByRole('heading', { name: 'Live' })).toBeInTheDocument();
    expect(screen.getByTestId('ipc-status')).toHaveTextContent('IPC: ready');
    expect(screen.getByRole('link', { name: 'Live' })).toHaveAttribute('aria-current', 'page');
  });

  it('navigates to the map page via the sidebar entry (06-ui.md §2)', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole('link', { name: 'Dust 2' }));

    expect(await screen.findByTestId('map-page-title')).toHaveTextContent('Dust 2');
    expect(screen.getByRole('link', { name: 'Dust 2' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Live' })).not.toHaveAttribute('aria-current');
  });

  it('navigates to the settings page and back to live', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole('link', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Live' }));
    expect(await screen.findByTestId('ipc-status')).toBeInTheDocument();
  });

  it('reaches a route by keyboard alone (UI-06)', async () => {
    const user = userEvent.setup();
    renderApp();

    await screen.findByRole('link', { name: 'Live' });
    await user.tab();
    expect(screen.getByRole('link', { name: 'Live' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'All maps' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Dust 2' })).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(await screen.findByTestId('map-page-title')).toHaveTextContent('Dust 2');
  });

  it('shows the fallback and reports through the shared reporter when a page throws', async () => {
    // React logs the caught render error; silence it to keep output clean.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    settingsThrows = true;
    const user = userEvent.setup();
    const { report } = renderApp();

    await user.click(await screen.findByRole('link', { name: 'Settings' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'settings page exploded' }),
      'Unhandled route error',
    );
  });
});
