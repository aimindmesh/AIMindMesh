import { driver, getSession } from '../db/neo4j';
import { Logger } from '../utils/Logger';
import neo4j from 'neo4j-driver';

export class KGManager {
  public static async upsertConcept(name: string, description: string, embedding: number[], enriched: boolean = false) {
    if (!name || name.trim().length <= 2) {
      Logger.warn('KGManager', `Skipping upsert for invalid concept name (too short): "${name}"`);
      return null;
    }
    if (!/[a-zA-Z0-9]/.test(name)) {
      Logger.warn('KGManager', `Skipping upsert for invalid concept name (no alphanumeric chars): "${name}"`);
      return null;
    }

    const session = getSession();
    try {
      const result = await session.run(`
        MERGE (c:Concept {name: $name})
        ON CREATE SET c.id = randomUUID(), c.createdAt = timestamp()
        SET c.description = $description, c.embedding = $embedding, c.updatedAt = timestamp(), c.enriched = $enriched
        RETURN c.id AS id
      `, { name, description, embedding, enriched });
      return result.records[0]?.get('id');
    } finally {
      await session.close();
    }
  }

  public static async linkConcepts(idA: string, idB: string, relType: string, weight: number = 1.0) {
    const session = getSession();
    try {
      await session.run(`
        MATCH (a:Concept {id: $idA})
        MATCH (b:Concept {id: $idB})
        MERGE (a)-[r:\`${relType}\`]->(b)
        SET r.weight = $weight, r.updatedAt = timestamp()
      `, { idA, idB, weight });
    } finally {
      await session.close();
    }
  }

  public static async semanticSearch(queryEmbedding: number[], topK: number, nodeType: string = 'Concept') {
    const session = getSession();
    try {
      const index = nodeType === 'Concept' ? 'concept_embedding' : 'memory_embedding';
      const result = await session.run(`
        CALL db.index.vector.queryNodes($index, $topK, $queryEmbedding)
        YIELD node, score
        RETURN node, score
      `, { index, topK, queryEmbedding });
      return result.records.map(r => ({ 
        node: r.get('node').properties, 
        labels: r.get('node').labels,
        score: r.get('score') 
      }));
    } finally {
      await session.close();
    }
  }

  public static async sampleUnexplored(limit: number) {
    const session = getSession();
    try {
      const result = await session.run(`
        MATCH (a:Concept), (b:Concept)
        WHERE id(a) < id(b) AND NOT (a)-[]-(b)
        WITH a, b, rand() as r
        ORDER BY r
        RETURN a, b
        LIMIT toInteger($limit)
      `, { limit });
      return result.records.map(r => ({ a: r.get('a').properties, b: r.get('b').properties }));
    } finally {
      await session.close();
    }
  }

  public static async getStats() {
    const session = getSession();
    try {
      const result = await session.run(`
        CALL {
          MATCH (n) WHERE NOT n:Chunk RETURN count(n) as nodeCount
        }
        CALL {
          MATCH ()-[r]->() 
          WHERE NOT startNode(r):Chunk AND NOT endNode(r):Chunk 
          RETURN count(r) as linkCount
        }
        CALL {
          MATCH (n)
          WHERE NOT n:Chunk
          WITH n, COUNT { (n)--() } as degree
          ORDER BY degree DESC
          LIMIT 10
          RETURN collect({id: n.id, name: coalesce(n.name, n.title), labels: labels(n), degree: degree}) as hubs
        }
        RETURN nodeCount, linkCount, hubs
      `);
      const record = result.records[0];
      return {
        nodeCount: record.get('nodeCount').toNumber(),
        linkCount: record.get('linkCount').toNumber(),
        hubs: record.get('hubs')
      };
    } finally {
      await session.close();
    }
  }

  public static async deleteNode(id: string) {
    const session = getSession();
    try {
      await session.run(`
        MATCH (n {id: $id})
        DETACH DELETE n
      `, { id });
    } finally {
      await session.close();
    }
  }

  public static async upsertMemory(content: string, embedding: number[], category: string, source: string) {
    const session = getSession();
    try {
      const result = await session.run(`
        CREATE (m:Memory {
          id: randomUUID(),
          content: $content,
          embedding: $embedding,
          category: $category,
          source: $source,
          createdAt: timestamp()
        })
        RETURN m.id AS id
      `, { content, embedding, category, source });

      if (result.records.length === 0) {
        throw new Error('Neo4j returned no result for upsertMemory');
      }
      return result.records[0].get('id');
    } catch (err: any) {
      Logger.error('KGManager', `Failed to upsert memory: ${err.message}`);
      throw err;
    } finally {
      await session.close();
    }
  }

  public static async createInsight(content: string, sourceNodeIds: string[]) {
    const session = getSession();
    try {
      const result = await session.run(`
        CREATE (i:Insight {
          id: randomUUID(),
          content: $content,
          createdAt: timestamp()
        })
        WITH i
        MATCH (a:Concept), (b:Concept) 
        WHERE a.id = $sourceNodeIds[0] AND b.id = $sourceNodeIds[1]
        CREATE (i)-[:DERIVED_FROM]->(a)
        CREATE (i)-[:DERIVED_FROM]->(b)
        MERGE (a)-[r:ANALYZED { last_cycle: timestamp() }]->(b)
        RETURN i.id AS id
      `, { content, sourceNodeIds });
      return result.records[0].get('id');
    } finally {
      await session.close();
    }
  }

  public static async getNodeById(id: string) {
    const session = getSession();
    try {
      const result = await session.run(`
        MATCH (n {id: $id})
        RETURN n, labels(n) as labels
      `, { id });
      if (result.records.length === 0) return null;
      const node = result.records[0].get('n').properties;
      const labels = result.records[0].get('labels');
      return { ...node, labels };
    } finally {
      await session.close();
    }
  }

  public static async getNeighbors(id: string, depth: number = 1) {
    if (depth === 0) {
      const node = await this.getNodeById(id);
      return {
        nodes: node ? [node] : [],
        links: []
      };
    }

    const session = getSession();
    try {
      const result = await session.run(`
        MATCH (n {id: $id})-[r*..${depth}]-(m)
        RETURN n, r, m
      `, { id });
      
      const nodesMap = new Map();
      const linksSet = new Set();
      
      result.records.forEach(record => {
        const n = record.get('n').properties;
        const m = record.get('m').properties;
        const relationships = record.get('r');
        
        nodesMap.set(n.id, { ...n, labels: record.get('n').labels });
        nodesMap.set(m.id, { ...m, labels: record.get('m').labels });
        
        relationships.forEach((rel: any) => {
          const linkKey = [rel.startNodeElementId, rel.endNodeElementId].sort().join('-');
          if (!linksSet.has(linkKey)) {
            linksSet.add(linkKey);
          }
        });
      });

      // Simple link structure for react-force-graph
      const links = result.records.flatMap(record => {
        return record.get('r').map((rel: any) => ({
          source: record.get('n').id === rel.startNodeElementId ? record.get('n').id : record.get('m').id,
          target: record.get('n').id === rel.endNodeElementId ? record.get('n').id : record.get('m').id,
          type: rel.type
        }));
      });

      return { 
        nodes: Array.from(nodesMap.values()), 
        links: links.filter((v:any, i:any, a:any) => a.findIndex((t:any) => (t.source === v.source && t.target === v.target)) === i)
      };
    } finally {
      await session.close();
    }
  }

  public static async getThematicClusters(limit: number): Promise<{ id: string, name: string, description: string, degree: number }[]> {
    const session = getSession();
    try {
      const result = await session.run(`
        MATCH (c:Concept)
        WITH c, COUNT { (c)--() } AS degree
        WHERE degree > 2
        RETURN c.id AS id, c.name AS name, c.description AS description, degree
        ORDER BY degree DESC
        LIMIT toInteger($limit)
      `, { limit });
      return result.records.map(r => ({
        id: r.get('id') as string,
        name: r.get('name') as string,
        description: r.get('description') as string,
        degree: r.get('degree')?.toNumber ? r.get('degree').toNumber() : (r.get('degree') as number)
      }));
    } finally {
      await session.close();
    }
  }

  public static async getClusterContext(clusterCenterId: string): Promise<{ center: any, neighbors: any[], relationships: any[] }> {
    const session = getSession();
    try {
      const result = await session.run(`
        MATCH (center:Concept {id: $clusterCenterId})
        OPTIONAL MATCH (center)-[r]-(neighbor:Concept)
        RETURN center, collect(r) AS rels, collect(neighbor) AS neighbors
      `, { clusterCenterId });
      
      if (result.records.length === 0) return { center: null, neighbors: [], relationships: [] };
      
      const record = result.records[0];
      const center = record.get('center')?.properties;
      const neighbors = record.get('neighbors').map((n: any) => n.properties);
      const rels = record.get('rels').map((r: any) => ({
        type: r.type,
        source: r.startNodeElementId === record.get('center').elementId ? center.id : neighbors.find((n: any) => n.elementId === r.startNodeElementId)?.id,
        target: r.endNodeElementId === record.get('center').elementId ? center.id : neighbors.find((n: any) => n.elementId === r.endNodeElementId)?.id,
      }));

      return { center, neighbors, relationships: rels };
    } finally {
      await session.close();
    }
  }

  public static async neuralExplore(queryEmbedding: number[], topK: number = 10) {
    const session = getSession();
    try {
      // Find top nodes and their relationships within the result set
      const result = await session.run(`
        CALL db.index.vector.queryNodes('concept_embedding', $topK, $queryEmbedding)
        YIELD node, score
        WITH collect(node) as nodes
        UNWIND nodes as n
        OPTIONAL MATCH (n)-[r]-(m)
        WHERE m IN nodes
        RETURN n, collect(r) as rels, collect(m) as neighbors
      `, { topK, queryEmbedding });

      const nodesMap = new Map();
      const links: any[] = [];

      result.records.forEach(record => {
        const n = record.get('n');
        nodesMap.set(n.properties.id, { ...n.properties, labels: n.labels });
        
        const rels = record.get('rels');
        const neighbors = record.get('neighbors');
        
        rels.forEach((rel: any, idx: number) => {
          const m = neighbors[idx];
          links.push({
            source: rel.startNodeElementId === n.elementId ? n.properties.id : m.properties.id,
            target: rel.startNodeElementId === m.elementId ? n.properties.id : m.properties.id,
            type: rel.type
          });
        });
      });

      return {
        nodes: Array.from(nodesMap.values()),
        links: links.filter((v, i, a) => a.findIndex(t => (t.source === v.source && t.target === v.target)) === i)
      };
    } finally {
      await session.close();
    }
  }

  // ── Document Ingestion Methods ───────────────────────────────────────────

  public static async upsertDocument(doc: {
    id: string;
    title: string;
    source: string;
    mimeType: string;
    charCount: number;
    chunkCount: number;
    contentHash?: string;
  }): Promise<void> {
    const session = getSession();
    try {
      await session.run(
        `MERGE (d:Document {id: $id})
         SET d.title     = $title,
             d.source    = $source,
             d.mimeType  = $mimeType,
             d.charCount = toInteger($charCount),
             d.chunkCount = toInteger($chunkCount),
             d.contentHash = $contentHash,
             d.updatedAt = timestamp(),
             d.createdAt = coalesce(d.createdAt, timestamp())`,
        { ...doc, contentHash: doc.contentHash ?? null }
      );
    } finally {
      await session.close();
    }
  }

  public static async upsertChunk(chunk: {
    id: string;
    docId: string;
    index: number;
    text: string;
    embedding: number[];
  }): Promise<void> {
    const session = getSession();
    try {
      await session.run(
        `MERGE (c:Chunk {id: $id})
         SET c.docId     = $docId,
             c.index     = toInteger($index),
             c.text      = $text,
             c.embedding = $embedding
         WITH c
         MATCH (d:Document {id: $docId})
         MERGE (d)-[:HAS_CHUNK]->(c)`,
        chunk
      );
    } finally {
      await session.close();
    }
  }

  public static async linkNodes(
    fromId: string,
    toId: string,
    relType: string,
    weight: number
  ): Promise<void> {
    const session = getSession();
    try {
      // Use raw Cypher for now to ensure compatibility without APOC dependency check
      // Sanitizing relType if needed, but assuming calling code is safe
      await session.run(
        `MATCH (a {id: $fromId}), (b {id: $toId})
         MERGE (a)-[r:MENTIONS]->(b)
         SET r.weight = $weight, r.updatedAt = timestamp()`,
        { fromId, toId, weight }
      );
    } finally {
      await session.close();
    }
  }

  public static async findConceptByName(name: string): Promise<{ id: string } | null> {
    const session = getSession();
    try {
      const result = await session.run(
        `MATCH (c:Concept {name: $name}) RETURN c.id AS id LIMIT 1`,
        { name }
      );
      if (result.records.length === 0) return null;
      return { id: result.records[0].get('id') as string };
    } finally {
      await session.close();
    }
  }

  public static async listDocuments(): Promise<any[]> {
    const session = getSession();
    try {
      const result = await session.run(
        `MATCH (d:Document)
         RETURN d.id AS id, d.title AS title, d.source AS source,
                d.mimeType AS mimeType, d.chunkCount AS chunkCount,
                d.createdAt AS createdAt
         ORDER BY d.createdAt DESC`
      );
      return result.records.map((r) => ({
        id: r.get('id'),
        title: r.get('title'),
        source: r.get('source'),
        mimeType: r.get('mimeType'),
        chunkCount: r.get('chunkCount')?.toNumber ? r.get('chunkCount').toNumber() : r.get('chunkCount'),
        date: r.get('createdAt')?.toNumber ? r.get('createdAt').toNumber() : r.get('createdAt'),
      }));
    } finally {
      await session.close();
    }
  }

  public static async deleteDocument(docId: string): Promise<void> {
    const session = getSession();
    try {
      await session.run(
        `MATCH (d:Document {id: $docId})
         OPTIONAL MATCH (d)-[:HAS_CHUNK]->(c:Chunk)
         DETACH DELETE c, d`,
        { docId }
      );
    } finally {
      await session.close();
    }
  }

  public static async getDocChunks(docId: string): Promise<any[]> {
    const session = getSession();
    try {
      const result = await session.run(
        `MATCH (d:Document {id: $docId})-[:HAS_CHUNK]->(c:Chunk)
         RETURN c.text AS text, c.index AS index
         ORDER BY c.index ASC`,
        { docId }
      );
      return result.records.map(r => ({
        text: r.get('text'),
        index: r.get('index')?.toNumber ? r.get('index').toNumber() : r.get('index')
      }));
    } finally {
      await session.close();
    }
  }

  public static async findDocumentByHash(contentHash: string): Promise<{ id: string; title: string, chunkCount: number } | null> {
    const session = getSession();
    try {
      const result = await session.run(
        `MATCH (d:Document {contentHash: $contentHash}) RETURN d.id AS id, d.title AS title, d.chunkCount AS chunkCount LIMIT 1`,
        { contentHash }
      );
      if (result.records.length === 0) return null;
      return {
        id: result.records[0].get('id') as string,
        title: result.records[0].get('title') as string,
        chunkCount: result.records[0].get('chunkCount')?.toNumber ? result.records[0].get('chunkCount').toNumber() : (result.records[0].get('chunkCount') || 0),
      };
    } finally {
      await session.close();
    }
  }

  public static async findDocumentByTitle(title: string): Promise<{ id: string, chunkCount: number } | null> {
    const session = getSession();
    try {
      const result = await session.run(
        `MATCH (d:Document {title: $title}) RETURN d.id AS id, d.chunkCount AS chunkCount LIMIT 1`,
        { title }
      );
      if (result.records.length === 0) return null;
      return {
        id: result.records[0].get('id') as string,
        chunkCount: result.records[0].get('chunkCount')?.toNumber ? result.records[0].get('chunkCount').toNumber() : (result.records[0].get('chunkCount') || 0),
      };
    } finally {
      await session.close();
    }
  }

  public static async deleteDocuments(docIds: string[]): Promise<void> {
    if (docIds.length === 0) return;
    const session = getSession();
    try {
      await session.run(
        `MATCH (d:Document) WHERE d.id IN $docIds
         OPTIONAL MATCH (d)-[:HAS_CHUNK]->(c:Chunk)
         DETACH DELETE c, d`,
        { docIds }
      );
    } finally {
      await session.close();
    }
  }

  public static async deleteAllDocuments(): Promise<void> {
    const session = getSession();
    try {
      await session.run(
        `MATCH (d:Document)
         OPTIONAL MATCH (d)-[:HAS_CHUNK]->(c:Chunk)
         DETACH DELETE c, d`
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Returns Insight nodes that were derived from a given Concept.
   * Used by WikiSynthesisService to enrich wiki pages with related insights.
   */
  public static async getInsightsForConcept(
    conceptId: string,
    limit = 5
  ): Promise<{ id: string; content: string; createdAt: number }[]> {
    const session = getSession();
    try {
      const result = await session.run(
        `MATCH (i:Insight)-[:DERIVED_FROM]->(c:Concept {id: $conceptId})
         RETURN i.id AS id, i.content AS content, i.createdAt AS createdAt
         ORDER BY i.createdAt DESC
         LIMIT toInteger($limit)`,
        { conceptId, limit }
      );
      return result.records.map(r => ({
        id: r.get('id') as string,
        content: r.get('content') as string,
        createdAt: r.get('createdAt')?.toNumber ? r.get('createdAt').toNumber() : (r.get('createdAt') as number),
      }));
    } finally {
      await session.close();
    }
  }
}

