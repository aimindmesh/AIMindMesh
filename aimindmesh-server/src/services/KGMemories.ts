import { getSession } from '../db/neo4j';

/**
 * Deletes the memory a device pushed with `syncId` (the user forgot it, or it was replaced on
 * the phone). Returns whether it existed.
 */
export async function deleteMemoryBySyncId(syncId: string): Promise<boolean> {
  const session = getSession();
  try {
    const result = await session.run(`
      MATCH (m:Memory {syncId: $syncId})
      WITH m, m.id AS id
      DETACH DELETE m
      RETURN count(id) AS deleted
    `, { syncId });
    return Number(result.records[0]?.get('deleted') ?? 0) > 0;
  } finally {
    await session.close();
  }
}
