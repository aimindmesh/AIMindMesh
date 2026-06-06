import { getSession } from '../../db/neo4j';

export class DecisionMemoryService {
  async saveDecision(input: { type: string; payload: Record<string, unknown> }): Promise<void> {
    const session = getSession();
    try {
      await session.run(`
        CREATE (d:Decision {
          id: $id,
          type: $type,
          payload: $payload,
          createdAt: $createdAt
        })
      `, {
        id: (input.payload.id as string) || new Date().getTime().toString(),
        type: input.type,
        payload: JSON.stringify(input.payload),
        createdAt: new Date().toISOString()
      });
    } catch (e) {
      console.error('Failed to save decision to Neo4j:', e);
    } finally {
      await session.close();
    }
  }

  async linkDirectiveToIdea(directiveId: string, ideaId: string): Promise<void> {
    const session = getSession();
    try {
      await session.run(`
        MATCH (d:Directive {id: $directiveId})
        MATCH (i:Idea {id: $ideaId})
        MERGE (d)-[:INFLUENCES]->(i)
      `, { directiveId, ideaId });
    } catch (e) {
      console.error('Failed to link directive to idea in Neo4j:', e);
    } finally {
      await session.close();
    }
  }

  async linkRoleToProposedIdea(roleId: string, ideaId: string): Promise<void> {
    const session = getSession();
    try {
      await session.run(`
        MATCH (r:OrgRole {id: $roleId})
        MATCH (i:Idea {id: $ideaId})
        MERGE (r)-[:PROPOSED]->(i)
      `, { roleId, ideaId });
    } catch (e) {
      console.error('Failed to link role to proposed idea in Neo4j:', e);
    } finally {
      await session.close();
    }
  }

  async linkDecisionToIdeaApproval(decisionId: string, ideaId: string): Promise<void> {
    const session = getSession();
    try {
      await session.run(`
        MATCH (d:Decision {id: $decisionId})
        MATCH (i:Idea {id: $ideaId})
        MERGE (d)-[:APPROVED]->(i)
      `, { decisionId, ideaId });
    } catch (e) {
      console.error('Failed to link decision to idea in Neo4j:', e);
    } finally {
      await session.close();
    }
  }

  async linkDecisionToRepoCreated(decisionId: string, repoId: string): Promise<void> {
    const session = getSession();
    try {
      await session.run(`
        MATCH (d:Decision {id: $decisionId})
        MATCH (r:Repo {id: $repoId})
        MERGE (d)-[:CREATED]->(r)
      `, { decisionId, repoId });
    } catch (e) {
      console.error('Failed to link decision to repo in Neo4j:', e);
    } finally {
      await session.close();
    }
  }

  async linkRoleProposalMaterialized(proposalId: string, roleId: string): Promise<void> {
    const session = getSession();
    try {
      await session.run(`
        MATCH (p:RoleProposal {id: $proposalId})
        MATCH (r:OrgRole {id: $roleId})
        MERGE (p)-[:MATERIALIZED_AS]->(r)
      `, { proposalId, roleId });
    } catch (e) {
      console.error('Failed to link proposal to role in Neo4j:', e);
    } finally {
      await session.close();
    }
  }
}
