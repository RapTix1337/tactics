import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GsiSetupPlan } from '@/lib/ipc/gsi-setup';
import { useSettingsStore } from '@/stores/settings-store';

import type { TacticsBridge } from '../../../shared/bridge';
import type { CommandResult } from '../../../shared/envelope';
import type { Settings } from '../../../shared/settings';
import { GsiPortSection } from './GsiPortSection';

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

const readyPlan: GsiSetupPlan = {
  status: 'ready',
  source: 'detected',
  gameRoot: 'C:\\Games\\Counter-Strike Global Offensive',
  configPath:
    'C:\\Games\\Counter-Strike Global Offensive\\game\\csgo\\cfg\\gamestate_integration_tactics.cfg',
  port: 42731,
};

type Invoke = (command: string, input: unknown) => Promise<CommandResult<unknown>>;

function installBridge(invoke: Invoke): ReturnType<typeof vi.fn> {
  const spy = vi.fn(invoke);
  const bridge = {
    invoke: spy,
    subscribe: (): never => {
      throw new Error('the section never subscribes');
    },
  } as unknown as TacticsBridge;
  Object.defineProperty(window, 'tactics', { value: bridge, configurable: true });
  return spy;
}

/** Bridge with a fixed plan answer and a fixed settings.update answer. */
function installSectionBridge(
  plan: CommandResult<GsiSetupPlan>,
  update: CommandResult<Settings> = { ok: true, data: storedSettings },
): ReturnType<typeof vi.fn> {
  return installBridge((command) => {
    if (command === 'gsi.getSetupPlan') {
      return Promise.resolve(plan as CommandResult<unknown>);
    }
    return Promise.resolve(update as CommandResult<unknown>);
  });
}

beforeEach(() => {
  useSettingsStore.setState({ settings: storedSettings });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'tactics');
  useSettingsStore.setState({ settings: undefined });
});

describe('GsiPortSection', () => {
  it('shows a loading state until the settings slice arrives', () => {
    useSettingsStore.setState({ settings: undefined });
    installSectionBridge({ ok: true, data: readyPlan });
    render(<GsiPortSection />);

    expect(screen.getByText('Loading settings…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save port' })).not.toBeInTheDocument();
  });

  it('defaults to automatic and shows the effective port from the plan', async () => {
    installSectionBridge({ ok: true, data: readyPlan });
    render(<GsiPortSection />);

    expect(await screen.findByText('Automatic — currently using port 42731.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Set port manually' })).not.toBeChecked();
    expect(screen.queryByRole('textbox', { name: 'Port' })).not.toBeInTheDocument();
  });

  it('stays functional without an effective port when CS2 is missing', async () => {
    installSectionBridge({ ok: true, data: { status: 'cs2-not-found' } });
    render(<GsiPortSection />);

    expect(await screen.findByText('Automatic port selection.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Set port manually' })).not.toBeChecked();
  });

  it('initializes manual mode from the store slice', async () => {
    useSettingsStore.setState({ settings: { ...storedSettings, gsiPort: 48000 } });
    installSectionBridge({ ok: true, data: readyPlan });
    render(<GsiPortSection />);

    expect(screen.getByRole('switch', { name: 'Set port manually' })).toBeChecked();
    expect(await screen.findByRole('textbox', { name: 'Port' })).toHaveValue('48000');
  });

  it('saves a manual port as the partial and re-initializes from the event', async () => {
    const newSettings: Settings = { ...storedSettings, gsiPort: 43210 };
    const user = userEvent.setup();
    const invoke = installSectionBridge(
      { ok: true, data: readyPlan },
      { ok: true, data: newSettings },
    );
    render(<GsiPortSection />);

    await user.click(screen.getByRole('switch', { name: 'Set port manually' }));
    await user.type(screen.getByRole('textbox', { name: 'Port' }), '43210');
    await user.click(screen.getByRole('button', { name: 'Save port' }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('settings.update', { gsiPort: 43210 });
    });
    // No optimistic UI (ADR-033): the submit itself never writes the store.
    expect(useSettingsStore.getState().settings).toEqual(storedSettings);

    // The wiring applies evt:settings.changed — the form re-inits from it.
    act(() => {
      useSettingsStore.setState({ settings: newSettings });
    });
    expect(screen.getByRole('textbox', { name: 'Port' })).toHaveValue('43210');
    expect(screen.getByRole('switch', { name: 'Set port manually' })).toBeChecked();
  });

  it('rejects an out-of-range port before any command is sent', async () => {
    const user = userEvent.setup();
    const invoke = installSectionBridge({ ok: true, data: readyPlan });
    render(<GsiPortSection />);

    await user.click(screen.getByRole('switch', { name: 'Set port manually' }));
    await user.type(screen.getByRole('textbox', { name: 'Port' }), '70000');
    await user.click(screen.getByRole('button', { name: 'Save port' }));

    expect(await screen.findByText('Enter a port between 1 and 65535.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Port' })).toHaveAccessibleDescription(
      'Enter a port between 1 and 65535.',
    );
    expect(invoke).not.toHaveBeenCalledWith('settings.update', expect.anything());
  });

  it('rejects a non-numeric port before any command is sent', async () => {
    const user = userEvent.setup();
    const invoke = installSectionBridge({ ok: true, data: readyPlan });
    render(<GsiPortSection />);

    await user.click(screen.getByRole('switch', { name: 'Set port manually' }));
    await user.type(screen.getByRole('textbox', { name: 'Port' }), '4x2');
    await user.click(screen.getByRole('button', { name: 'Save port' }));

    expect(await screen.findByText('Enter a port between 1 and 65535.')).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith('settings.update', expect.anything());
  });

  it('resets to automatic by sending gsiPort null', async () => {
    useSettingsStore.setState({ settings: { ...storedSettings, gsiPort: 48000 } });
    const user = userEvent.setup();
    const invoke = installSectionBridge(
      { ok: true, data: readyPlan },
      { ok: true, data: storedSettings },
    );
    render(<GsiPortSection />);

    await user.click(screen.getByRole('switch', { name: 'Set port manually' }));
    await user.click(screen.getByRole('button', { name: 'Save port' }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('settings.update', { gsiPort: null });
    });
  });

  it('shows the command error and keeps the edited values', async () => {
    const user = userEvent.setup();
    installSectionBridge(
      { ok: true, data: readyPlan },
      { ok: false, error: { code: 'DB_ERROR', message: 'persistence failed' } },
    );
    render(<GsiPortSection />);

    await user.click(screen.getByRole('switch', { name: 'Set port manually' }));
    await user.type(screen.getByRole('textbox', { name: 'Port' }), '43210');
    await user.click(screen.getByRole('button', { name: 'Save port' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('persistence failed');
    expect(screen.getByRole('textbox', { name: 'Port' })).toHaveValue('43210');
    expect(useSettingsStore.getState().settings).toEqual(storedSettings);
  });
});
