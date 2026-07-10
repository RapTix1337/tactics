import './assets/globals.css';

import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import type { AppRouter } from './app/router';
import { createAppRouter } from './app/router';
import { startThemeApplication } from './app/theme-application';
import { createErrorReporter, installGlobalErrorHandlers } from './lib/errors/error-reporting';
import { bootstrapIpc } from './lib/ipc/bootstrap';
import { getBridge } from './lib/ipc/bridge';
import { ipcWiring } from './lib/ipc/wiring';

const bridge = getBridge();

// Error capture first (E6.2, §8.3): errors thrown during the bootstrap and
// the initial render below already reach the main log. The reporter wants
// the current route, the router's error boundaries want the reporter — the
// box breaks that cycle: the getter resolves lazily and simply yields no
// route until the router exists a few lines further down.
const routerBox: { router?: AppRouter } = {};
const report = createErrorReporter(bridge, () => routerBox.router?.state.location.pathname);
installGlobalErrorHandlers(window, report);

// Theme before the first paint (UI-04): dark by default, re-applied on
// settings changes and OS scheme changes (E13.1).
startThemeApplication(window);

// Subscriptions + snapshot start immediately (04-data-flow.md §4); the UI
// renders in parallel and reflects the store as it fills. Module scope, so
// StrictMode's double render never double-bootstraps.
void bootstrapIpc(bridge, ipcWiring);

const router = createAppRouter(report);
routerBox.router = router;

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Renderer HTML is missing the #root container');
}

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
