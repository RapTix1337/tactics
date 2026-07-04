import type { JSX } from 'react';

import { APP_NAME } from '../shared';

// Placeholder screen (E3.2). The test id is the stable root selector the
// E2E spike asserts against (E4.1) — renaming it breaks the E2E contract.
export function App(): JSX.Element {
  return (
    <main data-testid="app-root">
      <h1>{APP_NAME}</h1>
      <p>Walking skeleton — the UI foundation lands in E13.</p>
    </main>
  );
}
