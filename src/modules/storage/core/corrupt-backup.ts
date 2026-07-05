/**
 * Naming for the corrupt-database backup (ADR-023): before a fresh database
 * is created, the damaged file is moved aside under this name so its data
 * stays available for manual inspection.
 */
export function corruptBackupFileName(databaseFileName: string, timestamp: Date): string {
  const fileSystemSafeTimestamp = timestamp.toISOString().replaceAll(':', '-').replace('.', '-');
  return `${databaseFileName}.corrupt-${fileSystemSafeTimestamp}`;
}
