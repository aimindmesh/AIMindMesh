import { afterEach, describe, expect, it } from 'vitest';
import db from '../src/db/sqlite';
import { config } from '../src/config';
import { pruneLogs, retentionDays } from '../src/services/LogRetention';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;
const logs = () => (db.prepare(`SELECT id FROM system_logs ORDER BY id`).all() as { id: string }[]).map(r => r.id);

afterEach(() => {
  delete (config.logging as any).retentionDays;
  db.exec(`DELETE FROM system_logs; DELETE FROM sync_logs;`);
});

describe('log retention', () => {
  it('defaults to 14 days and ignores invalid values', () => {
    expect(retentionDays()).toBe(14);
    for (const bad of ['abc', 0, -3, null]) {
      (config.logging as any).retentionDays = bad;
      expect(retentionDays()).toBe(14);
    }
    (config.logging as any).retentionDays = '30';
    expect(retentionDays()).toBe(30);
  });

  it('deletes only rows older than the retention, across batches', async () => {
    const insert = db.prepare(`INSERT INTO system_logs (id, level, module, message, timestamp) VALUES (?, 'INFO', 'm', 'x', ?)`);
    db.transaction(() => {
      for (let i = 0; i < 12_000; i++) insert.run(`old-${String(i).padStart(5, '0')}`, NOW - 20 * DAY);
      insert.run('recent', NOW - 2 * DAY);
    })();
    db.prepare(`INSERT INTO sync_logs (id, device_id, direction, entity_type, status, timestamp) VALUES ('s', 'd', 'UPLOAD', 'MIXED', 'SUCCESS', ?)`)
      .run(NOW - 20 * DAY);

    const deleted = await pruneLogs(NOW);

    expect(deleted).toMatchObject({ system_logs: 12_000, sync_logs: 1, fcm_logs: 0 });
    expect(logs()).toEqual(['recent']);
  });
});
