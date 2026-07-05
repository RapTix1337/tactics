import { describe, expect, expectTypeOf, it } from 'vitest';

import type { ContractCommandDefinitions } from './commands';
import { appGetSnapshot, appReportRendererError, logsExport, logsOpenDirectory } from './commands';
import { COMMAND_NAMES, EVENT_DOMAINS } from './contract-names';
import type { ContractEventDefinitions } from './events';

describe('contract name lists', () => {
  it('lists exactly the defined commands (both directions, type level)', () => {
    expectTypeOf<(typeof COMMAND_NAMES)[number]>().toEqualTypeOf<
      keyof ContractCommandDefinitions
    >();

    expect(COMMAND_NAMES).toContain(appGetSnapshot.name);
    expect(COMMAND_NAMES).toContain(appReportRendererError.name);
    expect(COMMAND_NAMES).toContain(logsOpenDirectory.name);
    expect(COMMAND_NAMES).toContain(logsExport.name);
    expect(new Set(COMMAND_NAMES).size).toBe(COMMAND_NAMES.length);
  });

  it('keys every command definition by its own name (type level)', () => {
    // Load-bearing: the bridge derives channels from the map keys, main
    // registers under definition.name — a mismatch would be a dead command.
    expectTypeOf<{
      [K in keyof ContractCommandDefinitions]: ContractCommandDefinitions[K]['name'];
    }>().toEqualTypeOf<{ [K in keyof ContractCommandDefinitions]: K }>();
  });

  it('lists exactly the defined event domains (type level)', () => {
    expectTypeOf<(typeof EVENT_DOMAINS)[number]>().toEqualTypeOf<keyof ContractEventDefinitions>();

    // Events land with their owning tasks (E8.3, E10.7, E18.1).
    expect(EVENT_DOMAINS).toHaveLength(0);
  });
});
