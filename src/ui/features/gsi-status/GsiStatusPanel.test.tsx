import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGameStateStore } from '@/stores/game-state-store';

import type { TacticsBridge } from '../../../shared/bridge';
import type { GsiConnectionStatus } from '../../../shared/game-state';
import { GsiStatusPanel } from './GsiStatusPanel';

function setStatus(status: GsiConnectionStatus): void {
  useGameStateStore.setState({ gameState: { status, map: { kind: 'none' } } });
}

function installBridge(): void {
  const bridge = {
    invoke: vi.fn().mockResolvedValue({ ok: true, data: { status: 'cs2-not-found' } }),
    subscribe: (): never => {
      throw new Error('the panel never subscribes');
    },
  } as unknown as TacticsBridge;
  Object.defineProperty(window, 'tactics', { value: bridge, configurable: true });
}

beforeEach(() => {
  useGameStateStore.setState({ gameState: undefined });
  installBridge();
});

afterEach(() => {
  Reflect.deleteProperty(window, 'tactics');
});

describe('GsiStatusPanel', () => {
  it('renders the badge and no action button before the snapshot arrives', () => {
    render(<GsiStatusPanel />);

    expect(screen.getByRole('status', { name: 'GSI connection status' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each<readonly [GsiConnectionStatus, string]>([
    ['repair-needed', 'Repair now'],
    ['connected', 'GSI setup…'],
  ])('labels the dialog button for %s as "%s"', (status, label) => {
    setStatus(status);
    render(<GsiStatusPanel />);

    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
  });

  it('auto-offers the dialog when the first status is not-set-up (MVP-02 first start)', async () => {
    setStatus('not-set-up');
    render(<GsiStatusPanel />);

    expect(
      await screen.findByRole('dialog', { name: 'Set up Game State Integration' }),
    ).toBeInTheDocument();
  });

  it.each<GsiConnectionStatus>(['waiting', 'connected', 'stale', 'repair-needed'])(
    'stays quiet when the status is %s — only not-set-up is auto-offered',
    (status) => {
      setStatus(status);
      render(<GsiStatusPanel />);

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    },
  );

  it('offers only once per session — closing keeps it closed', async () => {
    const user = userEvent.setup();
    setStatus('not-set-up');
    render(<GsiStatusPanel />);
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up now' })).toBeInTheDocument();
    act(() => {
      setStatus('not-set-up');
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the dialog in repair wording from the badge button (GSI-06)', async () => {
    const user = userEvent.setup();
    setStatus('repair-needed');
    render(<GsiStatusPanel />);

    await user.click(screen.getByRole('button', { name: 'Repair now' }));

    expect(
      await screen.findByRole('dialog', { name: 'Repair GSI configuration' }),
    ).toBeInTheDocument();
  });
});
