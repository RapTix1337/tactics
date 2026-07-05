import { describe, expect, it } from 'vitest';

import type { Migration } from './migration-plan';
import {
  MigrationHistoryMismatchError,
  planMigrations,
  SchemaDowngradeError,
} from './migration-plan';

const migrations: readonly Migration[] = [
  { id: 0, name: '0000_create_settings', sql: 'create table settings (id integer primary key)' },
  { id: 1, name: '0001_create_state', sql: 'create table state (id integer primary key)' },
  { id: 2, name: '0002_add_column', sql: 'alter table state add column note text' },
];

describe('planMigrations', () => {
  it('returns everything for a fresh database', () => {
    expect(planMigrations([], migrations)).toEqual(migrations);
  });

  it('returns only the migrations beyond the applied prefix', () => {
    const applied = [
      { id: 0, name: '0000_create_settings' },
      { id: 1, name: '0001_create_state' },
    ];

    expect(planMigrations(applied, migrations)).toEqual([migrations[2]]);
  });

  it('returns nothing when the database is up to date', () => {
    const applied = migrations.map(({ id, name }) => ({ id, name }));

    expect(planMigrations(applied, migrations)).toEqual([]);
  });

  it('tolerates applied records arriving out of order', () => {
    const applied = [
      { id: 1, name: '0001_create_state' },
      { id: 0, name: '0000_create_settings' },
    ];

    expect(planMigrations(applied, migrations)).toEqual([migrations[2]]);
  });

  it('rejects a database written by a newer app version', () => {
    const applied = [...migrations.map(({ id, name }) => ({ id, name })), { id: 3, name: '0003' }];

    const attempt = (): unknown => planMigrations(applied, migrations);

    expect(attempt).toThrow(SchemaDowngradeError);
    expect(attempt).toThrow(/schema version 3 is newer than this app's version 2/);
  });

  it('rejects an applied migration whose name diverges from the bundle', () => {
    const applied = [{ id: 0, name: '0000_something_else' }];

    expect(() => planMigrations(applied, migrations)).toThrow(MigrationHistoryMismatchError);
  });

  it('rejects an applied history with a gap', () => {
    const applied = [
      { id: 0, name: '0000_create_settings' },
      { id: 2, name: '0002_add_column' },
    ];

    expect(() => planMigrations(applied, migrations)).toThrow(MigrationHistoryMismatchError);
  });

  it('rejects a bundle whose ids are not strictly increasing', () => {
    const duplicated = [migrations[0], migrations[0]] as readonly Migration[];

    expect(() => planMigrations([], duplicated)).toThrow(MigrationHistoryMismatchError);
  });

  it('handles both sides empty', () => {
    expect(planMigrations([], [])).toEqual([]);
  });
});
