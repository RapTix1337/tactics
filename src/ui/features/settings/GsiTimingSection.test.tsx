import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGameStateStore } from '@/stores/game-state-store';
import { useSettingsStore } from '@/stores/settings-store';

import type { TacticsBridge } from '../../../shared/bridge';
import type { CommandResult } from '../../../shared/envelope';
import type { Settings } from '../../../shared/settings';
import { GSI_RESTART_NOTICE } from '../gsi-status/GsiSetupDialog';
import { GsiTimingSection } from './GsiTimingSection';

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
  overlayScoreboardOpacity: 1,
  overlayMapOpacity: 1,
  overlayCalloutOpacity: 1,
  overlayChromeOpacity: 1,
};

function installBridge(update: CommandResult<Settings>): ReturnType<typeof vi.fn> {
  const spy = vi.fn(() => Promise.resolve(update as CommandResult<unknown>));
  const bridge = {
    invoke: spy,
    subscribe: (): never => {
      throw new Error('the section never subscribes');
    },
  } as unknown as TacticsBridge;
  Object.defineProperty(window, 'tactics', { value: bridge, configurable: true });
  return spy;
}

beforeEach(() => {
  useSettingsStore.setState({ settings: storedSettings });
  useGameStateStore.setState({ gameState: { status: 'connected', map: { kind: 'none' } } });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'tactics');
  useSettingsStore.setState({ settings: undefined });
  useGameStateStore.setState({ gameState: undefined });
});

describe('GsiTimingSection', () => {
  it('shows a loading state until the settings slice arrives', () => {
    useSettingsStore.setState({ settings: undefined });
    installBridge({ ok: true, data: storedSettings });
    render(<GsiTimingSection onRepair={vi.fn()} />);

    expect(screen.getByText('Loading settings…')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('renders the three profiles with the persisted one selected', () => {
    installBridge({ ok: true, data: storedSettings });
    render(<GsiTimingSection onRepair={vi.fn()} />);

    expect(screen.getByRole('radiogroup', { name: 'GSI timing profile' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Slow/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /Default/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Fast/ })).not.toBeChecked();
  });

  it('shows the GSI-04 restart notice verbatim', () => {
    installBridge({ ok: true, data: storedSettings });
    render(<GsiTimingSection onRepair={vi.fn()} />);

    expect(screen.getByText(GSI_RESTART_NOTICE, { exact: false })).toBeInTheDocument();
  });

  it('sends exactly the picked profile as a settings.update partial', async () => {
    const user = userEvent.setup();
    const invoke = installBridge({ ok: true, data: { ...storedSettings, gsiTiming: 'fast' } });
    render(<GsiTimingSection onRepair={vi.fn()} />);

    await user.click(screen.getByRole('radio', { name: /Fast/ }));

    expect(invoke).toHaveBeenCalledExactlyOnceWith('settings.update', { gsiTiming: 'fast' });
  });

  it('never writes the store itself — the selection moves only with the event (ADR-033)', async () => {
    const user = userEvent.setup();
    installBridge({ ok: true, data: { ...storedSettings, gsiTiming: 'fast' } });
    render(<GsiTimingSection onRepair={vi.fn()} />);

    await user.click(screen.getByRole('radio', { name: /Fast/ }));

    // The command resolved ok, but no event landed yet: still on default.
    expect(screen.getByRole('radio', { name: /Default/ })).toBeChecked();
    expect(useSettingsStore.getState().settings?.gsiTiming).toBe('default');

    // The wiring applies evt:settings.changed — now the selection follows.
    act(() => {
      useSettingsStore.setState({ settings: { ...storedSettings, gsiTiming: 'fast' } });
    });
    expect(screen.getByRole('radio', { name: /Fast/ })).toBeChecked();
  });

  it('shows the update error and stays on the persisted profile', async () => {
    const user = userEvent.setup();
    installBridge({
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'Saving the setting failed.' },
    });
    render(<GsiTimingSection onRepair={vi.fn()} />);

    await user.click(screen.getByRole('radio', { name: /Slow/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Saving the setting failed.');
    expect(screen.getByRole('radio', { name: /Default/ })).toBeChecked();
  });

  it('clears the error once a later save succeeds', async () => {
    const user = userEvent.setup();
    const invoke = installBridge({
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'Saving the setting failed.' },
    });
    render(<GsiTimingSection onRepair={vi.fn()} />);

    await user.click(screen.getByRole('radio', { name: /Slow/ }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    invoke.mockResolvedValue({ ok: true, data: { ...storedSettings, gsiTiming: 'slow' } });
    await user.click(screen.getByRole('radio', { name: /Slow/ }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('points to the existing repair flow while the status is repair-needed', async () => {
    const user = userEvent.setup();
    const onRepair = vi.fn();
    useGameStateStore.setState({ gameState: { status: 'repair-needed', map: { kind: 'none' } } });
    installBridge({ ok: true, data: storedSettings });
    render(<GsiTimingSection onRepair={onRepair} />);

    // The badge vocabulary, not a new state (05-gsi.md §6.1).
    expect(screen.getByText('The GSI config file is missing or outdated.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Repair now' }));
    expect(onRepair).toHaveBeenCalledTimes(1);
  });

  it('shows no repair affordance in any other status', () => {
    installBridge({ ok: true, data: storedSettings });
    render(<GsiTimingSection onRepair={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Repair now' })).not.toBeInTheDocument();
    expect(
      screen.queryByText('The GSI config file is missing or outdated.'),
    ).not.toBeInTheDocument();
  });
});
