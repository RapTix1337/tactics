import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import type { CommandRequest, CommandResponse, EventPayload } from './contract';
import { defineCommand, defineEvent } from './contract';

// Sample definitions in the shape real contract entries will take.
const sampleCommand = defineCommand(
  'settings.update',
  z.object({ theme: z.enum(['dark', 'light']) }),
  z.object({ theme: z.enum(['dark', 'light']), gsiPort: z.number() }),
);
const sampleEvent = defineEvent('settings', z.object({ theme: z.enum(['dark', 'light']) }));

describe('defineCommand', () => {
  it('derives the cmd:<domain>.<action> channel from the name', () => {
    expect(sampleCommand.channel).toBe('cmd:settings.update');
  });

  it('infers request and response types from the schemas (both sides)', () => {
    expectTypeOf<CommandRequest<typeof sampleCommand>>().toEqualTypeOf<{
      theme: 'dark' | 'light';
    }>();
    expectTypeOf<CommandResponse<typeof sampleCommand>>().toEqualTypeOf<{
      theme: 'dark' | 'light';
      gsiPort: number;
    }>();
  });

  it('exposes the schemas for boundary validation', () => {
    expect(sampleCommand.requestSchema.safeParse({ theme: 'dark' }).success).toBe(true);
    expect(sampleCommand.requestSchema.safeParse({ theme: 'blue' }).success).toBe(false);
  });
});

describe('defineEvent', () => {
  it('derives the evt:<domain>.changed channel from the domain', () => {
    expect(sampleEvent.channel).toBe('evt:settings.changed');
  });

  it('infers the payload type from the schema', () => {
    expectTypeOf<EventPayload<typeof sampleEvent>>().toEqualTypeOf<{
      theme: 'dark' | 'light';
    }>();
  });
});
