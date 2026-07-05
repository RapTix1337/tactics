// Vitest setup for the ui project (wired in vitest.config.ts): registers
// the jest-dom matchers (toBeInTheDocument, …) on Vitest's expect.
import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// RTL only auto-cleans when test globals exist; this project uses explicit
// vitest imports (E1.4), so unmount rendered trees between tests here.
afterEach(cleanup);
