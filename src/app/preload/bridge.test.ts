import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';

import { defineCommand, defineEvent } from '../../shared/contract';
import type { CommandResult } from '../../shared/envelope';
import type { BridgeIpc } from './bridge';
import { createBridge } from './bridge';

const echoCommand = defineCommand(
  'test.echo',
  z.object({ value: z.string() }),
  z.object({ echoed: z.string() }),
);
const themeEvent = defineEvent('test', z.object({ theme: z.string() }));

interface TestCommands {
  'test.echo': typeof echoCommand;
}
interface TestEvents {
  test: typeof themeEvent;
}

const ENVELOPE: CommandResult<{ echoed: string }> = { ok: true, data: { echoed: 'ok' } };

function createTestBridge(): {
  bridge: ReturnType<typeof createBridge<TestCommands, TestEvents>>;
  invokes: readonly { channel: string; input: unknown }[];
  emit: (channel: string, payload: unknown) => void;
  listenerCount: (channel: string) => number;
} {
  const listeners = new Map<string, Set<(event: unknown, payload: unknown) => void>>();
  const invokes: { channel: string; input: unknown }[] = [];
  const ipc: BridgeIpc = {
    invoke: (channel, input): Promise<unknown> => {
      invokes.push({ channel, input });
      return Promise.resolve(ENVELOPE);
    },
    on: (channel, listener): void => {
      const set = listeners.get(channel) ?? new Set();
      set.add(listener);
      listeners.set(channel, set);
    },
    off: (channel, listener): void => {
      listeners.get(channel)?.delete(listener);
    },
  };
  return {
    bridge: createBridge<TestCommands, TestEvents>(ipc, ['test.echo'], ['test']),
    invokes,
    emit: (channel, payload): void => {
      for (const listener of listeners.get(channel) ?? []) {
        listener({}, payload);
      }
    },
    listenerCount: (channel): number => listeners.get(channel)?.size ?? 0,
  };
}

describe('createBridge', () => {
  it('exposes exactly invoke and subscribe', () => {
    const { bridge } = createTestBridge();
    expect(Object.keys(bridge).sort()).toEqual(['invoke', 'subscribe']);
  });

  it('invokes on the contract-derived cmd: channel and passes input and envelope through', async () => {
    const { bridge, invokes } = createTestBridge();

    await expect(bridge.invoke('test.echo', { value: 'hi' })).resolves.toEqual(ENVELOPE);
    expect(invokes).toEqual([{ channel: echoCommand.channel, input: { value: 'hi' } }]);
  });

  it('throws on a non-contract command before any channel is reached', () => {
    const { bridge, invokes } = createTestBridge();
    const invokeUnchecked = bridge.invoke as (command: string, input: unknown) => unknown;

    expect(() => invokeUnchecked('evil.command', {})).toThrow('Unknown command: evil.command');
    expect(invokes).toHaveLength(0);
  });

  it('delivers only the payload to subscribed handlers, never the IPC event', () => {
    const { bridge, emit } = createTestBridge();
    const handler = vi.fn();
    bridge.subscribe('test', handler);

    emit(themeEvent.channel, { theme: 'dark' });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ theme: 'dark' });
    expect(handler.mock.calls[0]).toHaveLength(1);
  });

  it('keeps two subscriptions independent; unsubscribing removes only its own', () => {
    const { bridge, emit, listenerCount } = createTestBridge();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = bridge.subscribe('test', first);
    bridge.subscribe('test', second);
    expect(listenerCount(themeEvent.channel)).toBe(2);

    unsubscribeFirst();
    emit(themeEvent.channel, { theme: 'light' });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(listenerCount(themeEvent.channel)).toBe(1);
  });

  it('treats a second unsubscribe call as a no-op', () => {
    const { bridge, emit, listenerCount } = createTestBridge();
    const remaining = vi.fn();
    const unsubscribe = bridge.subscribe('test', vi.fn());
    bridge.subscribe('test', remaining);

    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();

    emit(themeEvent.channel, { theme: 'dark' });
    expect(remaining).toHaveBeenCalledOnce();
    expect(listenerCount(themeEvent.channel)).toBe(1);
  });

  it('throws on a non-contract event', () => {
    const { bridge, listenerCount } = createTestBridge();
    const subscribeUnchecked = bridge.subscribe as (
      event: string,
      handler: (payload: unknown) => void,
    ) => unknown;

    expect(() => subscribeUnchecked('evil', vi.fn())).toThrow('Unknown event: evil');
    expect(listenerCount('evt:evil.changed')).toBe(0);
  });

  it('is contract-typed on both operations (type level)', () => {
    const { bridge } = createTestBridge();

    expectTypeOf(bridge.invoke<'test.echo'>)
      .parameter(1)
      .toEqualTypeOf<{ value: string }>();
    expectTypeOf(bridge.invoke<'test.echo'>).returns.toEqualTypeOf<
      Promise<CommandResult<{ echoed: string }>>
    >();
    expectTypeOf(bridge.subscribe<'test'>)
      .parameter(1)
      .toEqualTypeOf<(payload: { theme: string }) => void>();

    const compileTimeProof = (): void => {
      // @ts-expect-error — commands outside the contract are not invokable
      void bridge.invoke('not.in.contract', {});
      // @ts-expect-error — events outside the contract are not subscribable
      bridge.subscribe('not-a-domain', () => undefined);
    };
    expect(compileTimeProof).toBeTypeOf('function'); // proof is the compile, never invoked
  });
});
