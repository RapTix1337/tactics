import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useGameStateStore } from '@/stores/game-state-store';
import { useMapCatalogStore } from '@/stores/map-catalog-store';

import type { GameState } from '../../../shared/game-state';
import type { MapSummary } from '../../../shared/map-catalog';
import { LiveMatchHint } from './LiveMatchHint';

const dust2: MapSummary = {
  id: 'de_dust2',
  displayName: 'Dust 2',
  profiles: [],
};

const onDust2: GameState = { status: 'connected', map: { kind: 'resolved', mapId: 'de_dust2' } };
const onNuke: GameState = { status: 'connected', map: { kind: 'resolved', mapId: 'de_nuke' } };
const onWorkshopMap: GameState = {
  status: 'connected',
  map: { kind: 'unsupported', rawName: 'de_workshop' },
};
const inMenus: GameState = { status: 'connected', map: { kind: 'none' } };

// The hint reads the current route, so it needs a routing context. The
// harness pins it as the root component over stub routes — matching the real
// placement in RootComponent, which persists across navigation. Return type
// inferred on purpose: the router generics are inexpressible by hand and
// this helper is test-local.
async function renderHint(initialPath = '/maps') {
  const rootRoute = createRootRoute({
    component: (): JSX.Element => <LiveMatchHint />,
  });
  const stubRoute = (path: string) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: () => null });
  const router = createRouter({
    routeTree: rootRoute.addChildren([stubRoute('/live'), stubRoute('/maps')]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole('status', { name: 'Live match hint' });
  return router;
}

function setGameState(gameState: GameState | undefined): void {
  act(() => {
    useGameStateStore.setState({ gameState });
  });
}

describe('LiveMatchHint', () => {
  beforeEach(() => {
    useGameStateStore.setState({ gameState: undefined });
    useMapCatalogStore.setState({ list: undefined, profilesById: {} });
  });

  it('stays empty without game state and while no match is running', async () => {
    await renderHint();
    expect(screen.queryByText(/Match detected/)).not.toBeInTheDocument();

    setGameState(inMenus);
    expect(screen.queryByText(/Match detected/)).not.toBeInTheDocument();
  });

  it('announces a detected match with the catalog display name (E15.4)', async () => {
    useMapCatalogStore.setState({ list: [dust2] });
    await renderHint();

    setGameState(onDust2);

    const status = screen.getByRole('status', { name: 'Live match hint' });
    expect(status).toHaveTextContent('Match detected — Dust 2');
    expect(screen.getByRole('link', { name: 'Go to Live' })).toHaveAttribute('href', '/live');
  });

  it('falls back to the mapId while the catalog is not loaded', async () => {
    await renderHint();

    setGameState(onDust2);

    expect(screen.getByText('de_dust2')).toBeInTheDocument();
  });

  it('shows the raw name for an unsupported map (MVP-09 parity)', async () => {
    await renderHint();

    setGameState(onWorkshopMap);

    expect(screen.getByText('de_workshop')).toBeInTheDocument();
  });

  it('never shows on /live — the live view already is the destination', async () => {
    await renderHint('/live');

    setGameState(onDust2);

    expect(screen.queryByText(/Match detected/)).not.toBeInTheDocument();
  });

  it('jumps to /live and hides on the jump action', async () => {
    const user = userEvent.setup();
    await renderHint();
    setGameState(onDust2);

    await user.click(screen.getByRole('link', { name: 'Go to Live' }));

    expect(screen.queryByText(/Match detected/)).not.toBeInTheDocument();
  });

  it('stays dismissed for the same match, re-arms on a map change', async () => {
    const user = userEvent.setup();
    await renderHint();
    setGameState(onDust2);

    await user.click(screen.getByRole('button', { name: 'Dismiss match hint' }));
    expect(screen.queryByText(/Match detected/)).not.toBeInTheDocument();

    // Same match: still acknowledged.
    setGameState(onDust2);
    expect(screen.queryByText(/Match detected/)).not.toBeInTheDocument();

    // A different map is a new match: the hint returns.
    setGameState(onNuke);
    expect(screen.getByText(/Match detected/)).toBeInTheDocument();
  });

  it('re-arms after the match ends (map back to none)', async () => {
    const user = userEvent.setup();
    await renderHint();
    setGameState(onDust2);
    await user.click(screen.getByRole('button', { name: 'Dismiss match hint' }));

    setGameState(inMenus);
    setGameState(onDust2);

    expect(screen.getByText(/Match detected/)).toBeInTheDocument();
  });

  it('treats visiting /live during the match as acknowledgment', async () => {
    const user = userEvent.setup();
    const router = await renderHint();
    setGameState(onDust2);

    await user.click(screen.getByRole('link', { name: 'Go to Live' }));
    // Back on another route with the same match still running: stays hidden.
    await act(async () => {
      await router.navigate({ to: '/maps' });
    });

    expect(screen.queryByText(/Match detected/)).not.toBeInTheDocument();
  });
});
