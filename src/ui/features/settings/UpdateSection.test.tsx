import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TacticsBridge } from '../../../shared/bridge';
import type { CommandResult } from '../../../shared/envelope';
import type { Settings } from '../../../shared/settings';
import type { UpdateState } from '../../../shared/update-state';
import { useSettingsStore } from '../../stores/settings-store';
import { useUpdateStore } from '../../stores/update-store';
import { UpdateSection } from './UpdateSection';

const storedSettings: Settings = {
  theme: 'dark',
  cs2Path: null,
  gsiPort: null,
  autostart: false,
  closeToTray: true,
  autoUpdate: true,
};

const idle: UpdateState = { status: 'idle', version: null, errorKind: null };

function installBridge(
  result: CommandResult<void> = { ok: true, data: undefined },
): ReturnType<typeof vi.fn> {
  const invoke = vi.fn().mockResolvedValue(result);
  const bridge = {
    invoke,
    subscribe: (): never => {
      throw new Error('the section never subscribes');
    },
  } as unknown as TacticsBridge;
  Object.defineProperty(window, 'tactics', { value: bridge, configurable: true });
  return invoke;
}

beforeEach(() => {
  useSettingsStore.setState({ settings: storedSettings });
  useUpdateStore.setState({ updateState: idle });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'tactics');
  useSettingsStore.setState({ settings: undefined });
  useUpdateStore.setState({ updateState: undefined });
});

describe('UpdateSection', () => {
  it('shows a loading state until the update slice arrives', () => {
    useUpdateStore.setState({ updateState: undefined });
    installBridge();
    render(<UpdateSection />);

    expect(screen.getByText('Loading update status…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeDisabled();
  });

  it.each<[UpdateState, string]>([
    [idle, 'No update available.'],
    [{ status: 'checking', version: null, errorKind: null }, 'Checking for updates…'],
    [{ status: 'available', version: '1.2.3', errorKind: null }, 'Update 1.2.3 is available.'],
    [{ status: 'downloading', version: '1.2.3', errorKind: null }, 'Downloading update 1.2.3…'],
    [
      { status: 'ready', version: '1.2.3', errorKind: null },
      'Update 1.2.3 is ready. It installs when you quit TactiCS — or restart now.',
    ],
    [
      { status: 'error', version: null, errorKind: 'offline' },
      'The update check failed: you appear to be offline.',
    ],
    [
      { status: 'error', version: null, errorKind: 'rate-limited' },
      'The update check failed: too many requests — try again later.',
    ],
    [
      { status: 'error', version: null, errorKind: 'unknown' },
      'The update check failed. Details are in the log.',
    ],
  ])('renders the %o state appropriately', (state, expected) => {
    useUpdateStore.setState({ updateState: state });
    installBridge();
    render(<UpdateSection />);

    expect(screen.getByRole('status')).toHaveTextContent(expected);
  });

  it('sends updates.check from a resting state', async () => {
    const user = userEvent.setup();
    const invoke = installBridge();
    render(<UpdateSection />);

    await user.click(screen.getByRole('button', { name: 'Check for updates' }));

    expect(invoke).toHaveBeenCalledWith('updates.check', undefined);
  });

  it('disables the check while automatic updates are off and explains why (PRV-02)', () => {
    useSettingsStore.setState({ settings: { ...storedSettings, autoUpdate: false } });
    installBridge();
    render(<UpdateSection />);

    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeDisabled();
    expect(
      screen.getByText(
        'Automatic updates are disabled — no update checks are made. Enable them above to check for updates.',
      ),
    ).toBeInTheDocument();
  });

  it.each<UpdateState['status']>(['checking', 'available', 'downloading', 'ready'])(
    'disables the check outside the resting states (%s — the module never starts one there)',
    (status) => {
      useUpdateStore.setState({ updateState: { status, version: '1.2.3', errorKind: null } });
      installBridge();
      render(<UpdateSection />);

      expect(screen.getByRole('button', { name: 'Check for updates' })).toBeDisabled();
    },
  );

  it('re-enables the check in the error state', () => {
    useUpdateStore.setState({
      updateState: { status: 'error', version: null, errorKind: 'offline' },
    });
    installBridge();
    render(<UpdateSection />);

    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeEnabled();
  });

  it('offers Restart & install only when an update is ready and sends updates.install', async () => {
    useUpdateStore.setState({
      updateState: { status: 'ready', version: '1.2.3', errorKind: null },
    });
    const user = userEvent.setup();
    const invoke = installBridge();
    render(<UpdateSection />);

    await user.click(screen.getByRole('button', { name: 'Restart & install' }));

    expect(invoke).toHaveBeenCalledWith('updates.install', undefined);
  });

  it.each<UpdateState['status']>(['idle', 'checking', 'available', 'downloading', 'error'])(
    'hides Restart & install in the %s state',
    (status) => {
      useUpdateStore.setState({ updateState: { status, version: null, errorKind: null } });
      installBridge();
      render(<UpdateSection />);

      expect(screen.queryByRole('button', { name: 'Restart & install' })).not.toBeInTheDocument();
    },
  );

  it('shows a failed install as an alert (the UPDATE_NOT_READY race)', async () => {
    useUpdateStore.setState({
      updateState: { status: 'ready', version: '1.2.3', errorKind: null },
    });
    const user = userEvent.setup();
    installBridge({
      ok: false,
      error: { code: 'UPDATE_NOT_READY', message: 'no update is ready to install' },
    });
    render(<UpdateSection />);

    await user.click(screen.getByRole('button', { name: 'Restart & install' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('no update is ready to install');
  });

  it('shows a failed check as an alert', async () => {
    const user = userEvent.setup();
    installBridge({ ok: false, error: { code: 'INTERNAL', message: 'ipc broke' } });
    render(<UpdateSection />);

    await user.click(screen.getByRole('button', { name: 'Check for updates' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('ipc broke');
  });
});
