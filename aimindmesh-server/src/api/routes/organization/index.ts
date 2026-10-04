import { FastifyInstance } from 'fastify';
import { organizationRolesRoutes } from './roles';
import { organizationDirectivesRoutes } from './directives';
import { organizationIdeasRoutes } from './ideas';
import { organizationRepositoriesRoutes } from './repositories';
import { organizationHrRoutes } from './hr';
import { organizationDiscoveryRoutes } from './discovery';

/**
 * Organization layer API, mounted under /api/organization.
 * POST /webhooks/gitea (CI/CD events) lives in ../giteaWebhook.ts: it needs the raw body for HMAC verification.
 */
export async function organizationRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ ok: true, service: 'Organization Layer' }));

  // Registered without a prefix and without encapsulation concerns: every module keeps its full paths
  await organizationRolesRoutes(app);
  await organizationDirectivesRoutes(app);
  await organizationIdeasRoutes(app);
  await organizationRepositoriesRoutes(app);
  await organizationHrRoutes(app);
  await organizationDiscoveryRoutes(app);
}
