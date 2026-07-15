import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TacticsBridge } from '../../../shared/bridge';
import type { CommandResult } from '../../../shared/envelope';
import type { Settings } from '../../../shared/settings';
import { useSettingsStore } from '../../stores/settings-store';
import { ScoreboardSection } from './ScoreboardSection';

const storedSettings: Settings = {
  theme: 'dark',
  cs2Path: null,
  gsiPort: null,
  autostart: false,
  closeToTray: true,
  autoUpdate: true,
  scoreboardEnabled: true,
  scoreboardLayout: {
    groups: [
      { label: 'Match totals', fields: ['kills', 'deaths'] },
      { label: 'Derived', fields: ['hsRate'] },
    ],
  },
  gsiTiming: 'default',
  overlayOpacity: 1,
  overlayMapExempt: false,
  overlayScoreboardExempt: false,
};

type Invoke = (command: string, input: unknown) => Promise<CommandResult<unknown>>;

function installBridge(
  update: CommandResult<Settings> = { ok: true, data: storedSettings },
): ReturnType<typeof vi.fn> {
  const spy = vi.fn<Invoke>(() => Promise.resolve(update as CommandResult<unknown>));
  const bridge = {
    invoke: spy,
    subscribe: (): never => {
      throw new Error('the section never subscribes');
    },
  } as unknown as TacticsBridge;
  Object.defineProperty(window, 'tactics', { value: bridge, configurable: true });
  return spy;
}

function preview(): HTMLElement {
  return screen.getByRole('region', { name: 'My performance' });
}

/** The preview card renders `role="group"` too — scope builder queries. */
function builder(): HTMLElement {
  return screen.getByRole('region', { name: 'Scoreboard builder' });
}

beforeEach(() => {
  useSettingsStore.setState({ settings: storedSettings });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'tactics');
  useSettingsStore.setState({ settings: undefined });
});

describe('ScoreboardSection', () => {
  it('shows a loading state until the settings slice arrives', () => {
    useSettingsStore.setState({ settings: undefined });
    installBridge();
    render(<ScoreboardSection />);

    expect(screen.getByText('Loading settings…')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('mirrors scoreboardEnabled and dispatches the toggle as a partial', async () => {
    const user = userEvent.setup();
    const invoke = installBridge();
    render(<ScoreboardSection />);

    const toggle = screen.getByRole('switch', { name: 'Show scoreboard on the live map' });
    expect(toggle).toBeChecked();

    await user.click(toggle);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('settings.update', { scoreboardEnabled: false });
    });
    // No optimistic UI (ADR-033): the section never writes the store itself.
    expect(useSettingsStore.getState().settings).toEqual(storedSettings);
  });

  it('renders the builder from the persisted layout', () => {
    installBridge();
    render(<ScoreboardSection />);

    const groups = within(builder()).getAllByRole('group');
    expect(groups.map((element) => element.getAttribute('aria-label'))).toEqual([
      'Match totals',
      'Derived',
    ]);
  });

  it('persists a builder edit as a scoreboardLayout partial', async () => {
    const user = userEvent.setup();
    const invoke = installBridge();
    render(<ScoreboardSection />);

    await user.click(screen.getByRole('button', { name: 'Add MVPs to the scoreboard' }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('settings.update', {
        scoreboardLayout: {
          groups: [
            { label: 'Match totals', fields: ['kills', 'deaths', 'mvps'] },
            { label: 'Derived', fields: ['hsRate'] },
          ],
        },
      });
    });
    expect(useSettingsStore.getState().settings).toEqual(storedSettings);
  });

  it('shows the command error and reverts the draft to the persisted layout', async () => {
    const user = userEvent.setup();
    installBridge({ ok: false, error: { code: 'DB_ERROR', message: 'persistence failed' } });
    render(<ScoreboardSection />);

    await user.click(
      within(within(builder()).getByRole('group', { name: 'Match totals' })).getByRole('button', {
        name: 'Remove Kills',
      }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('persistence failed');
    // The draft reverted: the Kills chip is back.
    const chips = within(
      within(builder()).getByRole('group', { name: 'Match totals' }),
    ).getAllByRole('listitem');
    expect(chips.map((chip) => chip.textContent)).toEqual(['Kills', 'Deaths']);
  });

  it('re-initializes the builder when the persisted layout changes externally', () => {
    installBridge();
    render(<ScoreboardSection />);

    act(() => {
      useSettingsStore.setState({
        settings: {
          ...storedSettings,
          scoreboardLayout: { groups: [{ label: 'Economy', fields: ['money'] }] },
        },
      });
    });

    const groups = within(builder()).getAllByRole('group');
    expect(groups.map((element) => element.getAttribute('aria-label'))).toEqual(['Economy']);
  });

  it('previews the composed layout with the real MyPerformanceCard and sample data', () => {
    installBridge();
    render(<ScoreboardSection />);

    expect(within(preview()).getByText('Kills')).toBeInTheDocument();
    expect(within(preview()).getByText('19')).toBeInTheDocument();
    expect(within(preview()).getByText('58%')).toBeInTheDocument();
    expect(within(preview()).queryByText('MVPs')).not.toBeInTheDocument();
  });

  it('updates the preview immediately when the draft changes', async () => {
    const user = userEvent.setup();
    installBridge();
    render(<ScoreboardSection />);

    await user.click(screen.getByRole('button', { name: 'Add MVPs to the scoreboard' }));

    expect(within(preview()).getByText('MVPs')).toBeInTheDocument();
    expect(within(preview()).getByText('3')).toBeInTheDocument();
  });
});
