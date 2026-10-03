import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/InferenceRouter', () => ({ InferenceRouter: { setBrake: vi.fn() } }));

import { BackupService } from '../src/services/BackupService';

const statusOf = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (err: any) {
    return err.statusCode;
  }
};

describe('backup file names (path traversal)', () => {
  it('rejects anything that is not a plain .tar.gz name', () => {
    for (const name of ['../config.json', '..%2Fconfig.json', '/etc/passwd', 'x.tar.gz; rm -rf /', 'a/../../b.tar.gz', 'notes.txt']) {
      expect(statusOf(() => BackupService.getBackupPath(name))).toBe(400);
    }
  });

  it('accepts the names the service creates', () => {
    expect(BackupService.getBackupPath('backup-2026-10-03T10-00-00-000Z.tar.gz'))
      .toMatch(/\/backups\/backup-2026-10-03T10-00-00-000Z\.tar\.gz$/);
  });

  it('refuses to restore or delete outside the backup dir', async () => {
    await expect(BackupService.restoreBackup('../../config.json')).rejects.toMatchObject({ statusCode: 400 });
    await expect(BackupService.deleteBackup('../../config.json')).rejects.toMatchObject({ statusCode: 400 });
  });
});
