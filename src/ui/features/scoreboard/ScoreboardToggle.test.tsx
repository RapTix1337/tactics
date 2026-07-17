import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TacticsBridge } from '../../../shared/bridge';
import type { Settings } from '../../../shared/settings';
import { useSettingsStore } from '../../stores/settings-store';
import { ScoreboardToggle } from './ScoreboardToggle';

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
      throw new Error('the toggle never subscribes');
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

describe('ScoreboardToggle', () => {
  it('renders nothing before the settings snapshot arrives', () => {
    useSettingsStore.setState({ settings: undefined });
    const { container } = render(<ScoreboardToggle />);

    expect(container).toBeEmptyDOMElement();
  });

  it('reflects the persisted toggle state from the store (AC 1)', () => {
    render(<ScoreboardToggle />);
    expect(screen.getByRole('switch', { name: 'Scoreboard' })).toBeChecked();

    act(() => {
      useSettingsStore.setState({ settings: { ...storedSettings, scoreboardEnabled: false } });
    });
    expect(screen.getByRole('switch', { name: 'Scoreboard' })).not.toBeChecked();
  });

  it('dispatches settings.update without optimistic UI (ADR-033)', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue({ ok: true, data: { ...storedSettings, scoreboardEnabled: false } });
    installBridge(invoke);
    const user = userEvent.setup();
    render(<ScoreboardToggle />);

    await user.click(screen.getByRole('switch', { name: 'Scoreboard' }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('settings.update', { scoreboardEnabled: false });
    });
    // The click itself never writes the store — the switch flips only once
    // the wiring applies evt:settings.changed.
    expect(useSettingsStore.getState().settings).toEqual(storedSettings);
    expect(screen.getByRole('switch', { name: 'Scoreboard' })).toBeChecked();

    act(() => {
      useSettingsStore.setState({ settings: { ...storedSettings, scoreboardEnabled: false } });
    });
    expect(screen.getByRole('switch', { name: 'Scoreboard' })).not.toBeChecked();
  });
});
