import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defineEvent } from '../../shared';
import type { PublishTarget } from './event-publisher';
import { createEventPublisher } from './event-publisher';

const testEvent = defineEvent('test', z.object({ theme: z.string() }));

interface RecordingTarget extends PublishTarget {
  readonly sent: readonly { channel: string; payload: unknown }[];
}

function createTarget(destroyed = false): RecordingTarget {
  const sent: { channel: string; payload: unknown }[] = [];
  return {
    sent,
    isDestroyed: (): boolean => destroyed,
    send: (channel, payload): void => {
      sent.push({ channel, payload });
    },
  };
}

describe('createEventPublisher', () => {
  it('sends the payload on the contract-derived channel to every live target', () => {
    const first = createTarget();
    const second = createTarget();
    const publisher = createEventPublisher(() => [first, second]);

    publisher.publish(testEvent, { theme: 'dark' });

    const expected = [{ channel: 'evt:test.changed', payload: { theme: 'dark' } }];
    expect(first.sent).toEqual(expected);
    expect(second.sent).toEqual(expected);
  });

  it('skips destroyed targets', () => {
    const live = createTarget();
    const destroyed = createTarget(true);
    const publisher = createEventPublisher(() => [live, destroyed]);

    publisher.publish(testEvent, { theme: 'light' });

    expect(live.sent).toHaveLength(1);
    expect(destroyed.sent).toHaveLength(0);
  });

  it('reads the target list per publish, covering recreated windows', () => {
    const early = createTarget();
    const late = createTarget();
    let targets: readonly PublishTarget[] = [early];
    const publisher = createEventPublisher(() => targets);

    publisher.publish(testEvent, { theme: 'dark' });
    targets = [late];
    publisher.publish(testEvent, { theme: 'light' });

    expect(early.sent).toEqual([{ channel: 'evt:test.changed', payload: { theme: 'dark' } }]);
    expect(late.sent).toEqual([{ channel: 'evt:test.changed', payload: { theme: 'light' } }]);
  });

  it('rejects payloads outside the event contract (type level)', () => {
    const compileTimeProof = (): void => {
      const publisher = createEventPublisher(() => []);
      // @ts-expect-error — payload must match the event's schema type
      publisher.publish(testEvent, { theme: 42 });
    };
    expect(compileTimeProof).toBeTypeOf('function'); // proof is the compile, never invoked
  });
});
