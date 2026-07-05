export {
  openDatabase,
  type OpenDatabaseResult,
  type StorageDatabase,
} from './adapters/sqlite-database';
export {
  type AppliedMigration,
  type Migration,
  MigrationHistoryMismatchError,
  SchemaDowngradeError,
} from './core/migration-plan';
