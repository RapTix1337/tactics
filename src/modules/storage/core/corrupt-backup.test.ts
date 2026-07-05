import { describe, expect, it } from 'vitest';

import { corruptBackupFileName } from './corrupt-backup';

describe('corruptBackupFileName', () => {
  it('appends a filesystem-safe UTC timestamp to the database file name', () => {
    const name = corruptBackupFileName('tactics.db', new Date('2026-07-05T12:34:56.789Z'));

    expect(name).toBe('tactics.db.corrupt-2026-07-05T12-34-56-789Z');
  });

  it('never contains characters Windows forbids in file names', () => {
    const name = corruptBackupFileName('tactics.db', new Date());

    expect(name).not.toMatch(/[<>:"/\\|?*]/);
  });
});
