import db from '../db/sqlite';
import { Logger } from '../utils/Logger';

async function cleanup() {
  Logger.info('Cleanup', 'Starting duplicate candidate cleanup...');

  // 1. Identify duplicates by title and source_id
  const duplicates = db.prepare(`
    SELECT title, source_id, COUNT(*) as cnt
    FROM evolution_candidates
    GROUP BY title, source_id
    HAVING COUNT(*) > 1
  `).all() as any[];

  Logger.info('Cleanup', `Found ${duplicates.length} duplicate groups.`);

  for (const dup of duplicates) {
    const rows = db.prepare(`
      SELECT id, status, created_at 
      FROM evolution_candidates 
      WHERE title = ? AND source_id = ?
      ORDER BY 
        CASE status
          WHEN 'proposed' THEN 1
          WHEN 'merged' THEN 2
          WHEN 'validating' THEN 3
          WHEN 'generating' THEN 4
          WHEN 'pending' THEN 5
          ELSE 6
        END ASC,
        created_at DESC
    `).all(dup.title, dup.source_id) as any[];

    // Keep the first one (best status / most recent)
    const toKeep = rows[0].id;
    const toDelete = rows.slice(1).map(r => r.id);

    Logger.info('Cleanup', `Group "${dup.title}": keeping ${toKeep}, deleting ${toDelete.length} others.`);

    const deleteStmt = db.prepare(`DELETE FROM evolution_candidates WHERE id = ?`);
    for (const id of toDelete) {
      deleteStmt.run(id);
    }
  }

  Logger.info('Cleanup', 'Duplicate cleanup finished.');

  // 2. Add Unique Index if not exists
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_source_title ON evolution_candidates(source, source_id, title)`);
    Logger.info('Cleanup', 'Unique index created on evolution_candidates.');
  } catch (err: any) {
    Logger.error('Cleanup', 'Failed to create unique index: ' + err.message);
  }
}

cleanup().catch(err => {
  console.error(err);
  process.exit(1);
});
