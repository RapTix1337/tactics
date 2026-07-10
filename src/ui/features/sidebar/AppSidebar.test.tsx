import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { success } from '../../../shared/envelope';
import type { GameState } from '../../../shared/game-state';
import type { MapSummary } from '../../../shared/map-catalog';
import { SidebarProvider } from '../../components/ui/sidebar';
import { loadMapList } from '../../lib/ipc/map-catalog';
import { useGameStateStore } from '../../stores/game-state-store';
import { useMapCatalogStore } from '../../stores/map-catalog-store';
import { AppSidebar } from './AppSidebar';

vi.mock('../../lib/ipc/map-catalog', () => ({
  loadMapList: vi.fn(),
}));

// One map with an image, one without: the no-image hint (E22.4) appends
// " (no image)" to the accessible name of entries without an upload.
const dust2: MapSummary = {
  id: 'de_dust2',
  displayName: 'Dust 2',
  profiles: [{ id: 'p1', name: 'Default', imageUrl: 'tactics-map://de_dust2/p1.png' }],
  defaultProfileId: 'p1',
};

const nuke: MapSummary = { id: 'de_nuke', displayName: 'Nuke', profiles: [] };

interface RenderOptions {
  readonly initialPath?: string;
  readonly gsiStatusSlot?: ReactNode;
  readonly updateSlot?: ReactNode;
}

// The sidebar renders router links now, so it needs a routing context. This
// harness pins the sidebar as the root component over stub routes with the
// app's paths (06-ui.md §2) — full-app navigation is covered by
// src/ui/app/router.test.tsx.
async function renderSidebar(options: RenderOptions = {}): Promise<void> {
  const rootRoute = createRootRoute({
    component: (): JSX.Element => (
      <SidebarProvider>
        <AppSidebar gsiStatusSlot={options.gsiStatusSlot} updateSlot={options.updateSlot} />
      </SidebarProvider>
    ),
  });
  // Return type inferred on purpose: the route generics are inexpressible
  // by hand and this helper is test-local.
  const stubRoute = (path: string) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: () => null });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      stubRoute('/live'),
      stubRoute('/maps'),
      stubRoute('/maps/$mapId'),
      stubRoute('/settings'),
    ]),
    history: createMemoryHistory({ initialEntries: [options.initialPath ?? '/live'] }),
  });
  render(<RouterProvider router={router} />);
  // Prefix match: the accessible name is "Live (match in progress)" while a
  // match is running (E15.4).
  await screen.findByRole('link', { name: /^Live/ });
}

describe('AppSidebar', () => {
  beforeEach(() => {
    vi.mocked(loadMapList).mockReset().mockResolvedValue(success([]));
    useMapCatalogStore.setState({ list: undefined, profilesById: {} });
    useGameStateStore.setState({ gameState: undefined });
  });

  it('renders Live first, the maps group in between, and Settings last (UI-01)', async () => {
    useMapCatalogStore.setState({ list: [dust2, nuke] });
    await renderSidebar();

    const labels = screen.getAllByRole('link').map((link) => link.textContent);
    expect(labels).toEqual(['Live', 'All maps', 'Dust 2', 'Nuke', 'Settings']);
  });

  it('shows the All maps entry even while the catalog list is missing (E22.4)', async () => {
    await renderSidebar();

    expect(screen.getByRole('link', { name: 'All maps' })).toBeInTheDocument();
    const labels = screen.getAllByRole('link').map((link) => link.textContent);
    expect(labels).toEqual(['Live', 'All maps', 'Settings']);
  });

  it('fetches the map list on mount (the catalog store is command-fed, ADR-033)', async () => {
    await renderSidebar();

    expect(loadMapList).toHaveBeenCalledTimes(1);
  });

  it('links every entry to its 06-ui.md §2 route', async () => {
    useMapCatalogStore.setState({ list: [dust2] });
    await renderSidebar();

    expect(screen.getByRole('link', { name: 'Live' })).toHaveAttribute('href', '/live');
    expect(screen.getByRole('link', { name: 'All maps' })).toHaveAttribute('href', '/maps');
    expect(screen.getByRole('link', { name: 'Dust 2' })).toHaveAttribute('href', '/maps/de_dust2');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });

  it('marks maps without an uploaded image (E22.4)', async () => {
    useMapCatalogStore.setState({ list: [dust2, nuke] });
    await renderSidebar();

    expect(screen.getByRole('link', { name: 'Nuke (no image)' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dust 2' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Dust 2 (no image)' })).not.toBeInTheDocument();
  });

  it('marks only the entry of the current route (aria-current, UI-06)', async () => {
    useMapCatalogStore.setState({ list: [dust2, nuke] });
    await renderSidebar({ initialPath: '/maps/de_nuke' });

    expect(screen.getByRole('link', { name: 'Nuke (no image)' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Dust 2' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'All maps' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Live' })).not.toHaveAttribute('aria-current');
  });

  it('renders the GSI status badge slot before the settings entry (GSI-05)', async () => {
    await renderSidebar({ gsiStatusSlot: <span data-testid="gsi-badge-stub" /> });

    const badge = screen.getByTestId('gsi-badge-stub');
    const settings = screen.getByRole('link', { name: 'Settings' });
    expect(badge.compareDocumentPosition(settings)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('renders the update indicator slot before the GSI badge slot (E18.2)', async () => {
    await renderSidebar({
      gsiStatusSlot: <span data-testid="gsi-badge-stub" />,
      updateSlot: <span data-testid="update-indicator-stub" />,
    });

    const update = screen.getByTestId('update-indicator-stub');
    const badge = screen.getByTestId('gsi-badge-stub');
    expect(update.compareDocumentPosition(badge)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('marks the Live entry while a match is running (E15.4, ADR-046)', async () => {
    const inMatch: GameState = {
      status: 'connected',
      map: { kind: 'resolved', mapId: 'de_dust2' },
    };
    useGameStateStore.setState({ gameState: inMatch });
    await renderSidebar({ initialPath: '/maps' });

    expect(screen.getByRole('link', { name: 'Live (match in progress)' })).toBeInTheDocument();
  });

  it('marks the Live entry for an unsupported map too (E15.4)', async () => {
    const inMatch: GameState = {
      status: 'connected',
      map: { kind: 'unsupported', rawName: 'de_workshop' },
    };
    useGameStateStore.setState({ gameState: inMatch });
    await renderSidebar({ initialPath: '/maps' });

    expect(screen.getByRole('link', { name: 'Live (match in progress)' })).toBeInTheDocument();
  });

  it('shows the plain Live entry without a running match (E15.4)', async () => {
    const noMatch: GameState = { status: 'connected', map: { kind: 'none' } };
    useGameStateStore.setState({ gameState: noMatch });
    await renderSidebar({ initialPath: '/maps' });

    expect(screen.getByRole('link', { name: 'Live' })).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Live (match in progress)' }),
    ).not.toBeInTheDocument();
  });

  it('is fully keyboard-traversable in visual order (UI-06)', async () => {
    useMapCatalogStore.setState({ list: [dust2, nuke] });
    const user = userEvent.setup();
    await renderSidebar();

    await user.tab();
    expect(screen.getByRole('link', { name: 'Live' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'All maps' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Dust 2' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Nuke (no image)' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveFocus();
  });
});
