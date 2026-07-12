import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TacticsBridge } from '../../../shared/bridge';
import type { CommandResult } from '../../../shared/envelope';
import type { Settings } from '../../../shared/settings';
import type { GsiSetupPlan } from '../../lib/ipc/gsi-setup';
import { useSettingsStore } from '../../stores/settings-store';
import { Cs2PathSection } from './Cs2PathSection';

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
};

const detectedPlan: GsiSetupPlan = {
  status: 'ready',
  source: 'detected',
  gameRoot: 'C:\\Games\\Counter-Strike Global Offensive',
  configPath:
    'C:\\Games\\Counter-Strike Global Offensive\\game\\csgo\\cfg\\gamestate_integration_tactics.cfg',
  port: 42730,
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

/** Bridge whose plan answer is fixed and whose other commands succeed. */
function installPlanBridge(plan: CommandResult<GsiSetupPlan>): ReturnType<typeof vi.fn> {
  return installBridge((command) => {
    if (command === 'gsi.getSetupPlan') {
      return Promise.resolve(plan as CommandResult<unknown>);
    }
    return Promise.resolve({ ok: true, data: undefined });
  });
}

beforeEach(() => {
  useSettingsStore.setState({ settings: storedSettings });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'tactics');
  useSettingsStore.setState({ settings: undefined });
});

describe('Cs2PathSection', () => {
  it('shows the detected path with its source', async () => {
    installPlanBridge({ ok: true, data: detectedPlan });
    render(<Cs2PathSection onRepair={vi.fn()} />);

    expect(await screen.findByText(detectedPlan.gameRoot)).toBeInTheDocument();
    expect(screen.getByText('Detected automatically')).toBeInTheDocument();
  });

  it('labels a manual path source as such', async () => {
    installPlanBridge({ ok: true, data: { ...detectedPlan, source: 'manual' } });
    render(<Cs2PathSection onRepair={vi.fn()} />);

    expect(await screen.findByText('Set manually')).toBeInTheDocument();
  });

  it('shows the not-found state when no CS2 installation exists', async () => {
    installPlanBridge({ ok: true, data: { status: 'cs2-not-found' } });
    render(<Cs2PathSection onRepair={vi.fn()} />);

    expect(await screen.findByText(/No CS2 installation was found/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select CS2 folder…' })).toBeEnabled();
  });

  it('shows a failed plan fetch with a working retry', async () => {
    const user = userEvent.setup();
    let planCalls = 0;
    installBridge((command) => {
      if (command === 'gsi.getSetupPlan') {
        planCalls += 1;
        return planCalls === 1
          ? Promise.resolve({ ok: false, error: { code: 'INTERNAL', message: 'plan broke' } })
          : Promise.resolve({ ok: true, data: detectedPlan } as CommandResult<unknown>);
      }
      return Promise.resolve({ ok: true, data: undefined });
    });
    render(<Cs2PathSection onRepair={vi.fn()} />);

    expect(await screen.findByText('plan broke')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(detectedPlan.gameRoot)).toBeInTheDocument();
  });

  it('surfaces INVALID_PATH from the manual pick', async () => {
    const user = userEvent.setup();
    const invoke = installBridge((command) => {
      if (command === 'gsi.getSetupPlan') {
        return Promise.resolve({ ok: true, data: detectedPlan } as CommandResult<unknown>);
      }
      return Promise.resolve({
        ok: false,
        error: { code: 'INVALID_PATH', message: 'not a cs2 root' },
      });
    });
    render(<Cs2PathSection onRepair={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Select CS2 folder…' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The selected folder does not look like a CS2 installation.',
    );
    expect(invoke).toHaveBeenCalledWith('steam.pickCs2Path', undefined);
  });

  it('treats a canceled pick as a no-op', async () => {
    const user = userEvent.setup();
    installBridge((command) => {
      if (command === 'gsi.getSetupPlan') {
        return Promise.resolve({ ok: true, data: detectedPlan } as CommandResult<unknown>);
      }
      return Promise.resolve({ ok: true, data: { status: 'canceled' } });
    });
    render(<Cs2PathSection onRepair={vi.fn()} />);

    const pick = await screen.findByRole('button', { name: 'Select CS2 folder…' });
    await user.click(pick);

    await waitFor(() => {
      expect(pick).toBeEnabled();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('re-fetches the plan once the settings slice changes after a pick', async () => {
    const manualSettings: Settings = { ...storedSettings, cs2Path: 'D:\\CS2' };
    const user = userEvent.setup();
    let planCalls = 0;
    const invoke = installBridge((command) => {
      if (command === 'gsi.getSetupPlan') {
        planCalls += 1;
        const plan: GsiSetupPlan =
          planCalls === 1
            ? detectedPlan
            : { ...detectedPlan, gameRoot: 'D:\\CS2', source: 'manual' };
        return Promise.resolve({ ok: true, data: plan } as CommandResult<unknown>);
      }
      return Promise.resolve({ ok: true, data: { status: 'selected', settings: manualSettings } });
    });
    render(<Cs2PathSection onRepair={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Select CS2 folder…' }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('steam.pickCs2Path', undefined);
    });
    // No optimistic UI (ADR-033): the pick itself never writes the store.
    expect(screen.getByText(detectedPlan.gameRoot)).toBeInTheDocument();

    // The wiring applies evt:settings.changed — the plan hook re-fetches.
    act(() => {
      useSettingsStore.setState({ settings: manualSettings });
    });
    expect(await screen.findByText('D:\\CS2')).toBeInTheDocument();
    expect(screen.getByText('Set manually')).toBeInTheDocument();
  });

  it('reaches the repair flow via the repair button', async () => {
    const user = userEvent.setup();
    installPlanBridge({ ok: true, data: detectedPlan });
    const onRepair = vi.fn();
    render(<Cs2PathSection onRepair={onRepair} />);

    await user.click(screen.getByRole('button', { name: 'Repair GSI config…' }));

    expect(onRepair).toHaveBeenCalledTimes(1);
  });
});
