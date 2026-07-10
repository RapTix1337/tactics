import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TacticsBridge } from '../../../shared/bridge';
import type { CommandResult } from '../../../shared/envelope';
import type { GsiSetupPlan } from '../../lib/ipc/gsi-setup';
import { GsiSetupDialog } from './GsiSetupDialog';

const readyPlan: GsiSetupPlan = {
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
      throw new Error('the dialog never subscribes');
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

afterEach(() => {
  Reflect.deleteProperty(window, 'tactics');
});

describe('GsiSetupDialog', () => {
  it('previews exactly the plan main responded with (MVP-02)', async () => {
    installPlanBridge({ ok: true, data: readyPlan });
    render(<GsiSetupDialog open onOpenChange={vi.fn()} mode="setup" />);

    const dialog = await screen.findByRole('dialog', { name: 'Set up Game State Integration' });
    expect(dialog).toHaveTextContent(readyPlan.gameRoot);
    expect(dialog).toHaveTextContent(readyPlan.configPath);
    expect(dialog).toHaveTextContent('42730');
    expect(dialog).toHaveTextContent('Detected automatically');
  });

  it('labels a manual plan source as such', async () => {
    installPlanBridge({ ok: true, data: { ...readyPlan, source: 'manual' } });
    render(<GsiSetupDialog open onOpenChange={vi.fn()} mode="setup" />);

    expect(await screen.findByRole('dialog')).toHaveTextContent('Set manually in settings');
  });

  it('always shows the static restart-CS2 note (GSI-04, ADR-042)', async () => {
    installPlanBridge({ ok: true, data: { status: 'cs2-not-found' } });
    render(<GsiSetupDialog open onOpenChange={vi.fn()} mode="setup" />);

    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'CS2 loads Game State Integration configs only at game start',
    );
  });

  it('confirm triggers exactly one gsi.applySetup and closes on success', async () => {
    const user = userEvent.setup();
    const invoke = installPlanBridge({ ok: true, data: readyPlan });
    const onOpenChange = vi.fn();
    render(<GsiSetupDialog open onOpenChange={onOpenChange} mode="setup" />);

    await user.click(await screen.findByRole('button', { name: 'Write config file' }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(invoke.mock.calls.filter(([command]) => command === 'gsi.applySetup')).toHaveLength(1);
  });

  it('disables confirm while the write is pending — no double write', async () => {
    const user = userEvent.setup();
    let resolveApply: ((result: CommandResult<unknown>) => void) | undefined;
    const invoke = installBridge((command) => {
      if (command === 'gsi.getSetupPlan') {
        return Promise.resolve({ ok: true, data: readyPlan });
      }
      return new Promise((resolve) => {
        resolveApply = resolve;
      });
    });
    render(<GsiSetupDialog open onOpenChange={vi.fn()} mode="setup" />);

    const confirm = await screen.findByRole('button', { name: 'Write config file' });
    await user.click(confirm);
    expect(confirm).toBeDisabled();

    // TS cannot see the assignment inside the promise executor above.
    resolveApply?.({ ok: true, data: undefined });
    await waitFor(() => {
      expect(invoke.mock.calls.filter(([command]) => command === 'gsi.applySetup')).toHaveLength(1);
    });
  });

  it('shows the named error and stays open when the apply fails', async () => {
    const user = userEvent.setup();
    installBridge((command) => {
      if (command === 'gsi.getSetupPlan') {
        return Promise.resolve({ ok: true, data: readyPlan });
      }
      return Promise.resolve({
        ok: false,
        error: { code: 'CFG_DIR_NOT_WRITABLE', message: 'raw main message' },
      });
    });
    const onOpenChange = vi.fn();
    render(<GsiSetupDialog open onOpenChange={onOpenChange} mode="setup" />);

    await user.click(await screen.findByRole('button', { name: 'Write config file' }));

    expect(await screen.findByText(/config folder is not writable/)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('offers the manual folder pick on cs2-not-found and re-fetches after a pick (GSI-02)', async () => {
    const user = userEvent.setup();
    let planAnswer: CommandResult<GsiSetupPlan> = {
      ok: true,
      data: { status: 'cs2-not-found' },
    };
    installBridge((command) => {
      if (command === 'gsi.getSetupPlan') {
        return Promise.resolve(planAnswer as CommandResult<unknown>);
      }
      if (command === 'steam.pickCs2Path') {
        planAnswer = { ok: true, data: { ...readyPlan, source: 'manual' } };
        return Promise.resolve({ ok: true, data: { status: 'selected', settings: {} } });
      }
      return Promise.resolve({ ok: true, data: undefined });
    });
    render(<GsiSetupDialog open onOpenChange={vi.fn()} mode="setup" />);

    await user.click(await screen.findByRole('button', { name: 'Select CS2 folder…' }));

    expect(await screen.findByRole('button', { name: 'Write config file' })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent(readyPlan.gameRoot);
  });

  it('leaves the not-found state unchanged when the pick is canceled', async () => {
    const user = userEvent.setup();
    const invoke = installBridge((command) => {
      if (command === 'gsi.getSetupPlan') {
        return Promise.resolve({ ok: true, data: { status: 'cs2-not-found' } });
      }
      return Promise.resolve({ ok: true, data: { status: 'canceled' } });
    });
    render(<GsiSetupDialog open onOpenChange={vi.fn()} mode="setup" />);

    await user.click(await screen.findByRole('button', { name: 'Select CS2 folder…' }));

    expect(screen.getByRole('button', { name: 'Select CS2 folder…' })).toBeInTheDocument();
    expect(invoke.mock.calls.filter(([command]) => command === 'gsi.getSetupPlan')).toHaveLength(1);
  });

  it('shows the INVALID_PATH message when the picked folder is rejected', async () => {
    const user = userEvent.setup();
    installBridge((command) => {
      if (command === 'gsi.getSetupPlan') {
        return Promise.resolve({ ok: true, data: { status: 'cs2-not-found' } });
      }
      return Promise.resolve({
        ok: false,
        error: { code: 'INVALID_PATH', message: 'raw main message' },
      });
    });
    render(<GsiSetupDialog open onOpenChange={vi.fn()} mode="setup" />);

    await user.click(await screen.findByRole('button', { name: 'Select CS2 folder…' }));

    expect(await screen.findByText(/does not look like a CS2 installation/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select CS2 folder…' })).toBeInTheDocument();
  });

  it('shows a retryable error when the plan itself cannot be loaded', async () => {
    const user = userEvent.setup();
    let failFirst = true;
    installBridge((command) => {
      if (command === 'gsi.getSetupPlan') {
        if (failFirst) {
          failFirst = false;
          return Promise.resolve({
            ok: false,
            error: { code: 'INTERNAL', message: 'plan fetch broke' },
          });
        }
        return Promise.resolve({ ok: true, data: readyPlan });
      }
      return Promise.resolve({ ok: true, data: undefined });
    });
    render(<GsiSetupDialog open onOpenChange={vi.fn()} mode="setup" />);

    expect(await screen.findByText('plan fetch broke')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('button', { name: 'Write config file' })).toBeInTheDocument();
  });

  it('words the repair mode distinctly — same command underneath (GSI-06)', async () => {
    const user = userEvent.setup();
    const invoke = installPlanBridge({ ok: true, data: readyPlan });
    render(<GsiSetupDialog open onOpenChange={vi.fn()} mode="repair" />);

    expect(
      await screen.findByRole('dialog', { name: 'Repair GSI configuration' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Repair config file' }));

    await waitFor(() => {
      expect(invoke.mock.calls.filter(([command]) => command === 'gsi.applySetup')).toHaveLength(1);
    });
  });

  it('traps focus inside the dialog (UI-06)', async () => {
    installPlanBridge({ ok: true, data: readyPlan });
    render(<GsiSetupDialog open onOpenChange={vi.fn()} mode="setup" />);

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
  });
});
