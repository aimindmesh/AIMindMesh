import neo4j from 'neo4j-driver';
import { config } from '../config';

const driver = neo4j.driver(
  config.neo4j.uri,
  neo4j.auth.basic(config.neo4j.user, config.neo4j.password)
);

export async function initNeo4j() {
  const session = driver.session();
  try {
    await session.run(`
      CREATE VECTOR INDEX concept_embedding IF NOT EXISTS
      FOR (c:Concept)
      ON (c.embedding)
      OPTIONS {indexConfig: {
        \`vector.dimensions\`: 768,
        \`vector.similarity_function\`: 'cosine'
      }}
    `);

    await session.run(`
      CREATE VECTOR INDEX chunk_embedding IF NOT EXISTS
      FOR (c:Chunk)
      ON (c.embedding)
      OPTIONS {indexConfig: {
        \`vector.dimensions\`: 768,
        \`vector.similarity_function\`: 'cosine'
      }}
    `);

    // Constraints for ID-based lookups
    await session.run('CREATE CONSTRAINT concept_id_unique IF NOT EXISTS FOR (c:Concept) REQUIRE c.id IS UNIQUE');
    await session.run('CREATE CONSTRAINT doc_id_unique IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE');
    await session.run('CREATE CONSTRAINT chunk_id_unique IF NOT EXISTS FOR (c:Chunk) REQUIRE c.id IS UNIQUE');
    await session.run('CREATE CONSTRAINT insight_id_unique IF NOT EXISTS FOR (i:Insight) REQUIRE i.id IS UNIQUE');
    await session.run('CREATE CONSTRAINT orgrole_id_unique IF NOT EXISTS FOR (r:OrgRole) REQUIRE r.id IS UNIQUE');
    await session.run('CREATE CONSTRAINT directive_id_unique IF NOT EXISTS FOR (d:Directive) REQUIRE d.id IS UNIQUE');
    await session.run('CREATE CONSTRAINT idea_id_unique IF NOT EXISTS FOR (i:Idea) REQUIRE i.id IS UNIQUE');
    await session.run('CREATE CONSTRAINT decision_id_unique IF NOT EXISTS FOR (d:Decision) REQUIRE d.id IS UNIQUE');
    await session.run('CREATE CONSTRAINT repo_id_unique IF NOT EXISTS FOR (r:Repo) REQUIRE r.id IS UNIQUE');
    await session.run('CREATE CONSTRAINT roleproposal_id_unique IF NOT EXISTS FOR (p:RoleProposal) REQUIRE p.id IS UNIQUE');
    await session.run('CREATE CONSTRAINT validationrun_id_unique IF NOT EXISTS FOR (v:ValidationRun) REQUIRE v.id IS UNIQUE');

    console.log('Neo4j vector indices and uniqueness constraints verified.');
  } catch (err) {
    console.error('Neo4j index init failed:', err);
  } finally {
    await session.close();
  }
}

export function getSession() {
  return driver.session();
}

export { driver };
