import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { createErrorReporter, installGlobalErrorHandlers } from './lib/errors/error-reporting';
import { bootstrapIpc } from './lib/ipc/bootstrap';
import { getBridge } from './lib/ipc/bridge';
import { ipcWiring } from './lib/ipc/wiring';

const bridge = getBridge();

// Error capture first (E6.2, §8.3): errors thrown during the bootstrap and
// the initial render below already reach the main log.
installGlobalErrorHandlers(window, createErrorReporter(bridge));

// Subscriptions + snapshot start immediately (04-data-flow.md §4); the UI
// renders in parallel and reflects the store as it fills. Module scope, so
// StrictMode's double render never double-bootstraps.
void bootstrapIpc(bridge, ipcWiring);

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Renderer HTML is missing the #root container');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
