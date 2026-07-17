import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useGameStateStore } from '@/stores/game-state-store';

import type { GsiConnectionStatus } from '../../../shared/game-state';
import { GsiStatusBadge } from './GsiStatusBadge';

function setStatus(status: GsiConnectionStatus): void {
  useGameStateStore.setState({ gameState: { status, map: { kind: 'none' } } });
}

describe('GsiStatusBadge', () => {
  beforeEach(() => {
    useGameStateStore.setState({ gameState: undefined });
  });

  it.each<readonly [GsiConnectionStatus, string, string]>([
    ['not-set-up', 'Not set up', 'Game State Integration is not set up yet.'],
    ['waiting', 'Waiting for data', 'No data received — is CS2 running?'],
    ['connected', 'Connected', 'Receiving data from CS2.'],
    ['stale', 'Connection stale', 'Data stopped arriving — is CS2 still running?'],
    ['repair-needed', 'Repair needed', 'The GSI config file is missing or outdated.'],
  ])('renders %s with its distinct label and diagnostic help (GSI-05)', (status, label, help) => {
    setStatus(status);
    render(<GsiStatusBadge />);

    const region = screen.getByRole('status', { name: 'GSI connection status' });
    expect(region).toHaveTextContent(label);
    expect(region).toHaveTextContent(help);
  });

  it('keeps the live region in the DOM but empty before the first state arrives', () => {
    render(<GsiStatusBadge />);

    expect(screen.getByRole('status', { name: 'GSI connection status' })).toHaveTextContent('');
  });

  it('updates the live region content on status transitions (UI-06)', () => {
    setStatus('waiting');
    render(<GsiStatusBadge />);
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for data');

    act(() => {
      setStatus('connected');
    });

    expect(screen.getByRole('status')).toHaveTextContent('Connected');
    expect(screen.getByRole('status')).not.toHaveTextContent('Waiting for data');
  });
});
