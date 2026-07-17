import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUpdateStore } from '@/stores/update-store';

import type { TacticsBridge } from '../../../shared/bridge';
import type { CommandResult } from '../../../shared/envelope';
import type { UpdateState } from '../../../shared/update-state';
import { UpdateIndicator } from './UpdateIndicator';

function installBridge(
  result: CommandResult<void> = { ok: true, data: undefined },
): ReturnType<typeof vi.fn> {
  const invoke = vi.fn().mockResolvedValue(result);
  const bridge = {
    invoke,
    subscribe: (): never => {
      throw new Error('the indicator never subscribes');
    },
  } as unknown as TacticsBridge;
  Object.defineProperty(window, 'tactics', { value: bridge, configurable: true });
  return invoke;
}

afterEach(() => {
  Reflect.deleteProperty(window, 'tactics');
  useUpdateStore.setState({ updateState: undefined });
});

describe('UpdateIndicator', () => {
  it('renders nothing until the slice arrives', () => {
    installBridge();
    const { container } = render(<UpdateIndicator />);

    expect(container).toBeEmptyDOMElement();
  });

  it.each<UpdateState['status']>(['idle', 'checking', 'available', 'downloading', 'error'])(
    'renders nothing in the %s state (unobtrusive by design)',
    (status) => {
      useUpdateStore.setState({ updateState: { status, version: null, errorKind: null } });
      installBridge();
      const { container } = render(<UpdateIndicator />);

      expect(container).toBeEmptyDOMElement();
    },
  );

  it('announces a ready update with its version and sends updates.install', async () => {
    useUpdateStore.setState({
      updateState: { status: 'ready', version: '1.2.3', errorKind: null },
    });
    const user = userEvent.setup();
    const invoke = installBridge();
    render(<UpdateIndicator />);

    expect(screen.getByRole('status')).toHaveTextContent('Update 1.2.3 ready.');

    await user.click(screen.getByRole('button', { name: 'Restart & install' }));

    expect(invoke).toHaveBeenCalledWith('updates.install', undefined);
  });

  it('shows a failed install as an alert and stays actionable', async () => {
    useUpdateStore.setState({
      updateState: { status: 'ready', version: null, errorKind: null },
    });
    const user = userEvent.setup();
    installBridge({
      ok: false,
      error: { code: 'UPDATE_NOT_READY', message: 'no update is ready to install' },
    });
    render(<UpdateIndicator />);

    expect(screen.getByRole('status')).toHaveTextContent('Update ready.');

    await user.click(screen.getByRole('button', { name: 'Restart & install' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('no update is ready to install');
    expect(screen.getByRole('button', { name: 'Restart & install' })).toBeEnabled();
  });
});
