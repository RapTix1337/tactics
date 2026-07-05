import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App';
import { useAppStore } from './stores/app-store';

// RTL smoke test (E3.2 acceptance criterion).
describe('App', () => {
  it('renders the placeholder behind the stable E2E root selector', () => {
    render(<App />);

    expect(screen.getByTestId('app-root')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('TactiCS');
  });

  it('reflects the IPC status from the app store (E5.4)', () => {
    useAppStore.setState({ ipcStatus: 'ready', lastError: undefined });
    render(<App />);

    expect(screen.getByTestId('ipc-status')).toHaveTextContent('IPC: ready');
  });
});
