import type { Migration } from '../../modules/storage';

// Vite inlines the generated SQL files into the main bundle at build time
// (the packaged app has no migrations directory on disk); vitest's vite-node
// resolves the same glob in tests. The pattern must stay a literal — it is a
// compile-time transform, not a runtime read.
const migrationSql = import.meta.glob<string>('../../modules/storage/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/**
 * Bundles the drizzle-kit-generated SQL files (ADR-040) into the storage
 * module's `Migration` shape for `migrate()` at startup: the 0-based numeric
 * file prefix is the id, the file name without extension is the name — both
 * exactly as recorded in the central journal, so the runner's history check
 * stays meaningful across builds.
 */
export function loadBundledMigrations(): readonly Migration[] {
  return Object.entries(migrationSql)
    .map(([path, sql]) => {
      const fileName = path.split('/').at(-1) ?? path;
      const name = fileName.replace(/\.sql$/, '');
      const id = Number.parseInt(name, 10);
      if (Number.isNaN(id)) {
        // Build-time data bug: drizzle-kit always prefixes with the index.
        throw new Error(`migration file name has no numeric prefix: ${fileName}`);
      }
      return { id, name, sql };
    })
    .sort((a, b) => a.id - b.id);
}
