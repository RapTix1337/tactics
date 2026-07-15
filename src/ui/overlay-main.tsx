import './assets/globals.css';
import './overlay.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { RendererErrorBoundary } from './app/RendererErrorBoundary';
import { startThemeApplication } from './app/theme-application';
import { OverlayRoot } from './features/overlay/OverlayRoot';
import { createErrorReporter, installGlobalErrorHandlers } from './lib/errors/error-reporting';
import { bootstrapIpc } from './lib/ipc/bootstrap';
import { getBridge } from './lib/ipc/bridge';
import { ipcWiring } from './lib/ipc/wiring';

const bridge = getBridge();

// The main.tsx bootstrap minus the router — the overlay is one view
// (live-overlay 02-design.md §5.1). Errors report with the static route
// `overlay`; the class boundary renders the shared fallback (§6 case 8).
const report = createErrorReporter(bridge, () => 'overlay');
installGlobalErrorHandlers(window, report);

// Theme before the first paint (UI-04): the overlay carries the same tokens;
// only html/body go transparent (overlay.css).
startThemeApplication(window);

// Same wiring as the main window: the overlay mirrors the same stores from
// the same snapshot + events (spec AC 9/10). Module scope, so StrictMode's
// double render never double-bootstraps.
void bootstrapIpc(bridge, ipcWiring);

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Overlay renderer HTML is missing the #root container');
}

createRoot(container).render(
  <StrictMode>
    <RendererErrorBoundary report={report}>
      <OverlayRoot />
    </RendererErrorBoundary>
  </StrictMode>,
);
