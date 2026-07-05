import { defineConfig } from 'drizzle-kit';

/**
 * Single repo-root config per ADR-040: modules own their Drizzle table
 * definitions in `adapters/schema.ts`; all generated SQL migrations land in
 * the one central journal owned by the storage module, giving a strictly
 * total cross-module migration order by construction.
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/modules/*/adapters/schema.ts',
  out: './src/modules/storage/migrations',
});
