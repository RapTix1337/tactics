import type { ErrorComponentProps } from '@tanstack/react-router';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  getRouteApi,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import type { JSX } from 'react';

import { GsiStatusPanel } from '../features/gsi-status/GsiStatusPanel';
import { LiveMatchHint } from '../features/live-hint/LiveMatchHint';
import { UpdateIndicator } from '../features/settings/UpdateIndicator';
import { AppSidebar } from '../features/sidebar/AppSidebar';
import type { ErrorReporter } from '../lib/errors/error-reporting';
import { AppLayout } from './layouts/AppLayout';
import { RouteErrorFallback } from './RouteErrorFallback';
import { LivePage } from './routes/LivePage';
import { MapPage } from './routes/MapPage';
import { MapsOverviewPage } from './routes/MapsOverviewPage';
import { SettingsPage } from './routes/SettingsPage';

function RootComponent(): JSX.Element {
  return (
    <AppLayout
      sidebar={<AppSidebar gsiStatusSlot={<GsiStatusPanel />} updateSlot={<UpdateIndicator />} />}
    >
      {/* The hint banner sits above its own scroll container so full-height
          pages keep their exact viewport height while it shows (E15.4). */}
      <div className="flex h-full flex-col">
        <LiveMatchHint />
        <div className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </div>
      </div>
    </AppLayout>
  );
}

const mapRouteApi = getRouteApi('/maps/$mapId');

function MapRouteComponent(): JSX.Element {
  const { mapId } = mapRouteApi.useParams();
  return <MapPage mapId={mapId} />;
}

/**
 * The app router (E13.3, 06-ui.md §2): memory history — Electron has no URL
 * bar, navigation state lives in the renderer and resets on reload
 * (ADR-028). The route tree is built per call so every test gets an
 * isolated router; `report` is the shared error reporter — the router's
 * error boundaries escalate through it (03-technical-design.md §8.3).
 */
function buildRouter(report: ErrorReporter) {
  const rootRoute = createRootRoute({ component: RootComponent });

  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    beforeLoad: () => {
      // The maps overview is the app home (MVP-11, E22.4). `throw: true`
      // lets the library throw its redirect object — a plain
      // `throw redirect(...)` trips @typescript-eslint/only-throw-error.
      redirect({ to: '/maps', throw: true });
    },
  });

  const liveRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/live',
    component: LivePage,
  });

  const mapsOverviewRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/maps',
    component: MapsOverviewPage,
  });

  const mapRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/maps/$mapId',
    component: MapRouteComponent,
  });

  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings',
    component: SettingsPage,
  });

  return createRouter({
    routeTree: rootRoute.addChildren([
      indexRoute,
      liveRoute,
      mapsOverviewRoute,
      mapRoute,
      settingsRoute,
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    defaultErrorComponent: function AppRouteError({ error }: ErrorComponentProps): JSX.Element {
      return <RouteErrorFallback error={error} report={report} />;
    },
  });
}

export type AppRouter = ReturnType<typeof buildRouter>;

export function createAppRouter(report: ErrorReporter): AppRouter {
  return buildRouter(report);
}

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
