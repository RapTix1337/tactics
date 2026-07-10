import { describe, expect, it } from 'vitest';

import { loadBundledMigrations } from './bundled-migrations';

describe('loadBundledMigrations', () => {
  it('bundles every generated migration in journal order', () => {
    const migrations = loadBundledMigrations();

    // Ids are the contiguous 0-based journal positions (E7.3 runner contract).
    expect(migrations.length).toBeGreaterThanOrEqual(3);
    expect(migrations.map((migration) => migration.id)).toEqual(
      migrations.map((_, index) => index),
    );
    expect(migrations[0]?.name).toBe('0000_settings');
    expect(migrations[1]?.name).toBe('0001_operational-state');
    expect(migrations[2]?.name).toBe('0002_map-profiles');
  });

  it('carries the raw DDL content', () => {
    for (const migration of loadBundledMigrations()) {
      expect(migration.sql).toContain('CREATE TABLE');
    }
  });
});
