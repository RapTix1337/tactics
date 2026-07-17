import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TacticsBridge } from '../../../shared/bridge';
import type { Settings } from '../../../shared/settings';
import { useSettingsStore } from '../../stores/settings-store';
import { SettingsForm } from './SettingsForm';

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

function installBridge(invoke: ReturnType<typeof vi.fn>): void {
  const bridge = {
    invoke,
    subscribe: (): never => {
      throw new Error('the form never subscribes');
    },
  } as unknown as TacticsBridge;
  Object.defineProperty(window, 'tactics', { value: bridge, configurable: true });
}

beforeEach(() => {
  useSettingsStore.setState({ settings: storedSettings });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'tactics');
  useSettingsStore.setState({ settings: undefined });
});

describe('SettingsForm', () => {
  it('shows a loading state until the settings slice arrives', () => {
    useSettingsStore.setState({ settings: undefined });
    render(<SettingsForm />);

    expect(screen.getByText('Loading settings…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('initializes every field from the store slice', () => {
    render(<SettingsForm />);

    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveTextContent('Dark');
    expect(screen.getByRole('switch', { name: 'Start with Windows' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Close to tray' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Automatic updates' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Close to tray' })).toHaveAccessibleDescription(
      'Keep TactiCS running in the tray when the window is closed.',
    );
  });

  it('submits the four fields as a partial and re-initializes from the store event', async () => {
    const newSettings: Settings = { ...storedSettings, theme: 'light', autostart: true };
    const invoke = vi.fn().mockResolvedValue({ ok: true, data: newSettings });
    installBridge(invoke);
    const user = userEvent.setup();
    render(<SettingsForm />);

    await user.click(screen.getByRole('combobox', { name: 'Theme' }));
    await user.click(await screen.findByRole('option', { name: 'Light' }));
    await user.click(screen.getByRole('switch', { name: 'Start with Windows' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('settings.update', {
        theme: 'light',
        autostart: true,
        closeToTray: true,
        autoUpdate: true,
      });
    });
    // No optimistic UI (ADR-033): the submit itself never writes the store.
    expect(useSettingsStore.getState().settings).toEqual(storedSettings);

    // The wiring applies evt:settings.changed — the form re-inits from it.
    act(() => {
      useSettingsStore.setState({ settings: newSettings });
    });
    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveTextContent('Light');
    expect(screen.getByRole('switch', { name: 'Start with Windows' })).toBeChecked();
  });

  it('round-trips a single toggle through main and reflects the event back', async () => {
    const newSettings: Settings = { ...storedSettings, closeToTray: false };
    const invoke = vi.fn().mockResolvedValue({ ok: true, data: newSettings });
    installBridge(invoke);
    const user = userEvent.setup();
    render(<SettingsForm />);

    await user.click(screen.getByRole('switch', { name: 'Close to tray' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('settings.update', {
        theme: 'dark',
        autostart: false,
        closeToTray: false,
        autoUpdate: true,
      });
    });

    act(() => {
      useSettingsStore.setState({ settings: newSettings });
    });
    expect(screen.getByRole('switch', { name: 'Close to tray' })).not.toBeChecked();
  });

  it('shows the command error and keeps the edited values', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue({ ok: false, error: { code: 'DB_ERROR', message: 'persistence failed' } });
    installBridge(invoke);
    const user = userEvent.setup();
    render(<SettingsForm />);

    await user.click(screen.getByRole('switch', { name: 'Automatic updates' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('persistence failed');
    expect(screen.getByRole('switch', { name: 'Automatic updates' })).not.toBeChecked();
    expect(useSettingsStore.getState().settings).toEqual(storedSettings);
  });

  it('clears a previous error on the next submit', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'DB_ERROR', message: 'persistence failed' },
      })
      .mockResolvedValue({ ok: true, data: storedSettings });
    installBridge(invoke);
    const user = userEvent.setup();
    render(<SettingsForm />);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('persistence failed');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
