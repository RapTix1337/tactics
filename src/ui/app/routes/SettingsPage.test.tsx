import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TacticsBridge } from '../../../shared/bridge';
import type { CommandResult } from '../../../shared/envelope';
import type { Settings } from '../../../shared/settings';
import type { GsiSetupPlan } from '../../lib/ipc/gsi-setup';
import { useGameStateStore } from '../../stores/game-state-store';
import { useSettingsStore } from '../../stores/settings-store';
import { useUpdateStore } from '../../stores/update-store';
import { SettingsPage } from './SettingsPage';

const storedSettings: Settings = {
  theme: 'dark',
  cs2Path: null,
  gsiPort: null,
  autostart: false,
  closeToTray: true,
  autoUpdate: true,
  scoreboardEnabled: true,
  scoreboardLayout: { groups: [{ label: 'Match totals', fields: ['kills'] }] },
  gsiTiming: 'default',
  overlayOpacity: 1,
  overlayMapExempt: false,
  overlayScoreboardExempt: false,
};

const readyPlan: GsiSetupPlan = {
  status: 'ready',
  source: 'detected',
  gameRoot: 'C:\\Games\\Counter-Strike Global Offensive',
  configPath:
    'C:\\Games\\Counter-Strike Global Offensive\\game\\csgo\\cfg\\gamestate_integration_tactics.cfg',
  port: 42730,
};

function installBridge(): void {
  const bridge = {
    invoke: vi.fn((command: string) => {
      if (command === 'gsi.getSetupPlan') {
        return Promise.resolve({ ok: true, data: readyPlan } as CommandResult<unknown>);
      }
      return Promise.resolve({ ok: true, data: undefined });
    }),
    subscribe: (): never => {
      throw new Error('the page never subscribes');
    },
  } as unknown as TacticsBridge;
  Object.defineProperty(window, 'tactics', { value: bridge, configurable: true });
}

beforeEach(() => {
  useSettingsStore.setState({ settings: storedSettings });
  useUpdateStore.setState({ updateState: { status: 'idle', version: null, errorKind: null } });
  installBridge();
});

afterEach(() => {
  Reflect.deleteProperty(window, 'tactics');
  useSettingsStore.setState({ settings: undefined });
  useUpdateStore.setState({ updateState: undefined });
  useGameStateStore.setState({ gameState: undefined });
});

describe('SettingsPage', () => {
  it('renders all six settings sections (01-requirements.md §9)', async () => {
    render(<SettingsPage />);

    // E16.1: theme + the three toggles.
    expect(screen.getByRole('combobox', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Start with Windows' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Close to tray' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Automatic updates' })).toBeInTheDocument();
    // SCB.10: the scoreboard section with the builder.
    expect(
      screen.getByRole('switch', { name: 'Show scoreboard on the live map' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Scoreboard builder' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add group' })).toBeInTheDocument();
    // E16.2: CS2 path and the advanced GSI port.
    expect(await screen.findByText(readyPlan.gameRoot)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Set port manually' })).toBeInTheDocument();
    // SCB.11: the GSI timing section with the persisted profile selected.
    expect(screen.getByRole('radiogroup', { name: 'GSI timing profile' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Default/ })).toBeChecked();
    // E18.2: the updates section.
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeInTheDocument();
  });

  it('opens the E15.2 dialog in repair mode from the CS2 path section', async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByRole('button', { name: 'Repair GSI config…' }));

    const dialog = await screen.findByRole('dialog', { name: 'Repair GSI configuration' });
    expect(dialog).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Repair config file' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('opens the same repair dialog from the GSI timing section (SCB.11)', async () => {
    useGameStateStore.setState({ gameState: { status: 'repair-needed', map: { kind: 'none' } } });
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByRole('button', { name: 'Repair now' }));

    expect(await screen.findByRole('dialog', { name: 'Repair GSI configuration' })).toBeVisible();
  });
});
