import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SettingsStoragePort } from '../../modules/settings';
import { createSettingsRepository, SETTINGS_DEFAULTS } from '../../modules/settings';
import type { Logger } from '../../shared';
import { settingsChanged, settingsUpdate } from '../../shared';
import type { EventPublisher } from './event-publisher';
import type { CommandRegistrationDeps } from './register-command';
import type { SettingsCommandDeps } from './settings-commands';
import { registerSettingsCommands } from './settings-commands';

const silentLogger: Logger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

// The real generated DDL, not a hand-written copy (ADR-040): this is the
// full main-side chain — boundary validation → repository persistence →
// event publish — against exactly what `pnpm db:generate` produced.
const MIGRATIONS_DIRECTORY = join(
  import.meta.dirname,
  '..',
  '..',
  'modules',
  'storage',
  'migrations',
);

const connections: Database.Database[] = [];

function openPort(): SettingsStoragePort {
  const connection = new Database(':memory:');
  connections.push(connection);
  const files = readdirSync(MIGRATIONS_DIRECTORY)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const file of files) {
    connection.exec(readFileSync(join(MIGRATIONS_DIRECTORY, file), 'utf8'));
  }
  const typedAccess = drizzle(connection);
  return {
    drizzle: typedAccess,
    withTransaction: (fn) => connection.transaction(() => fn(typedAccess))(),
  };
}

afterEach(() => {
  for (const connection of connections.splice(0)) {
    if (connection.open) {
      connection.close();
    }
  }
});

interface FakeEvent {
  trusted: boolean;
}

type RegisteredListener = (event: FakeEvent, request: unknown) => Promise<unknown>;

function setup(overrides: Partial<SettingsCommandDeps> = {}): {
  invoke: (request: unknown) => Promise<unknown>;
  published: unknown[];
  getPersisted: () => unknown;
  errorLog: ReturnType<typeof vi.fn>;
} {
  const handlers = new Map<string, RegisteredListener>();
  const errorLog = vi.fn();
  const deps: CommandRegistrationDeps<FakeEvent> = {
    registerHandler: (channel, listener): void => {
      handlers.set(channel, listener);
    },
    isTrustedSender: (event): boolean => event.trusted,
    logger: { ...silentLogger, error: errorLog },
  };

  const repository = createSettingsRepository(openPort(), silentLogger);
  const published: unknown[] = [];
  const publisher: EventPublisher = {
    publish: (definition, payload): void => {
      published.push({ channel: definition.channel, payload });
    },
  };

  registerSettingsCommands(deps, {
    updateSettings: (partial) => repository.updateSettings(partial),
    publisher,
    ...overrides,
  });

  const listener = handlers.get(settingsUpdate.channel);
  if (listener === undefined) {
    throw new Error('settings.update was not registered');
  }
  return {
    invoke: (request) => listener({ trusted: true }, request),
    published,
    getPersisted: () => repository.getSettings(),
    errorLog,
  };
}

describe('registerSettingsCommands', () => {
  it('persists a valid partial, responds with the full new state, and publishes it', async () => {
    const { invoke, published, getPersisted } = setup();

    const expected = { ...SETTINGS_DEFAULTS, theme: 'light', gsiPort: 42731 };
    await expect(invoke({ theme: 'light', gsiPort: 42731 })).resolves.toEqual({
      ok: true,
      data: expected,
    });

    // §5.4: the event carries the full new slice, not a patch.
    expect(published).toEqual([{ channel: settingsChanged.channel, payload: expected }]);
    expect(getPersisted()).toEqual(expected);
  });

  it('rejects an invalid partial with INVALID_REQUEST — nothing persisted, no event', async () => {
    const { invoke, published, getPersisted } = setup();

    const result = (await invoke({ gsiPort: 65536 })) as { ok: boolean; error: { code: string } };

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_REQUEST');
    expect(published).toEqual([]);
    expect(getPersisted()).toEqual(SETTINGS_DEFAULTS);
  });

  it('maps a storage failure to DB_ERROR and publishes no event', async () => {
    const { invoke, published, errorLog } = setup({
      updateSettings: () => {
        throw new Error('SQLITE_IOERR: disk I/O error');
      },
    });

    const result = (await invoke({ theme: 'light' })) as {
      ok: boolean;
      error: { code: string; message: string };
    };

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('DB_ERROR');
    // The user-presentable message never carries internals (ADR-025).
    expect(result.error.message).not.toContain('SQLITE_IOERR');
    expect(published).toEqual([]);
    expect(errorLog).toHaveBeenCalledOnce();
  });

  it('surfaces a repository TypeError as INTERNAL (contract/module drift is a bug)', async () => {
    const { invoke, published } = setup({
      updateSettings: () => {
        throw new TypeError('invalid settings update for field(s): theme');
      },
    });

    const result = (await invoke({ theme: 'light' })) as { ok: boolean; error: { code: string } };

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INTERNAL');
    expect(published).toEqual([]);
  });
});
