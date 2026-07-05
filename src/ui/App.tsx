import type { JSX } from 'react';

import { APP_NAME } from '../shared/constants';
import { useAppStore } from './stores/app-store';

// Placeholder screen (E3.2). The test ids are stable E2E selectors:
// app-root is the E4.1 contract, ipc-status evidences the snapshot round
// trip (E5.4) — renaming either breaks the E2E suite.
export function App(): JSX.Element {
  const ipcStatus = useAppStore((state) => state.ipcStatus);

  return (
    <main data-testid="app-root">
      <h1>{APP_NAME}</h1>
      <p>Walking skeleton — the UI foundation lands in E13.</p>
      <p data-testid="ipc-status">IPC: {ipcStatus}</p>
    </main>
  );
}
