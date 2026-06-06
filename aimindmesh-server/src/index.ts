import Fastify from 'fastify';
import axios from 'axios';
import websocketPlugin from '@fastify/websocket';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs_sync from 'fs';
import { config } from './config';
import db from './db/sqlite';
import { initNeo4j } from './db/neo4j';
import { NodeRegistry } from './services/NodeRegistry';
import { ProactiveEngine } from './services/ProactiveEngine';
import { Logger } from './utils/Logger';
import { documentIngester as ingester } from './services/DocumentIngester';
import { GiteaService } from './services/GiteaService';
import { OpenClawHealthService } from './services/OpenClawHealthService';

import nodeRoutes from './api/routes/nodes';
import chatRoutes from './api/routes/chat';
import kgRoutes from './api/routes/kg';
import documentRoutes from './api/routes/documents';
import feedRoutes from './api/routes/feed';
import adminRoutes from './api/routes/admin';
import agentRoutes from './api/routes/agent';
import releaseRoutes from './api/routes/releases';
import deliveryRoutes from './api/routes/delivery';
import wikiRoutes from './api/routes/wiki';
import syncRoutes from './api/routes/sync';
import evolutionRoutes from './api/routes/evolution';
import aiTasksRoutes from './api/routes/aiTasksRouter';
import webRoutes from './api/routes/web';
import kasmRoutes from './api/routes/kasm';
import localSttRoutes from './api/routes/local-stt';
import { organizationRoutes } from './api/routes/organization';
import { researchRoutes } from './api/routes/research';
import { AiTaskScheduler } from './services/AiTaskScheduler';
import { InferenceRouter } from './services/InferenceRouter';
import { RecoveryService } from './services/RecoveryService';
import { OpenRouterService } from './services/OpenRouterService';



import chatWs from './api/websocket/chat.ws';
import statusWs from './api/websocket/status.ws';
import nodesWs from './api/websocket/nodes.ws';

async function checkConnectivity() {
  const ollamaUrl = config.ollama.baseUrl.replace(/\/$/, '') + '/api/tags';
  try {
    const res = await fetch(ollamaUrl);
    if (res.ok) {
      Logger.info('Connectivity', `Ollama reachability verified at ${ollamaUrl}`);
    } else {
      Logger.warn('Connectivity', `Ollama returned HTTP ${res.status} at ${ollamaUrl}`);
    }
  } catch (e: any) {
    Logger.error('Connectivity', `Ollama NOT reachable at ${ollamaUrl}. Connection error: ${e.message}`);
  }
}

const fastify = Fastify({ 
  logger: false,
  bodyLimit: 100 * 1024 * 1024 // 100MB to allow large sync payloads
});

async function build() {
  fastify.setErrorHandler((error: any, request, reply) => {
    Logger.error('FastifyError', `Error in ${request.method} ${request.url}: ${error.message}\nStack: ${error.stack}`);
    reply.status(error.statusCode || 500).send({ error: error.message });
  });

  await fastify.register(cors, {
    origin: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  });
  await fastify.register(websocketPlugin);
  await fastify.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024 // 50MB
    }
  });

  // ── Secure Desktop Distribution (VPN ONLY) ──────────────────────────────
  const downloadsDir = path.join(__dirname, '../data/downloads');
  if (!fs_sync.existsSync(downloadsDir)) {
      fs_sync.mkdirSync(downloadsDir, { recursive: true });
  }

  await fastify.register(fastifyStatic, {
    root: downloadsDir,
    prefix: '/dl/',
    decorateReply: false // To avoid double-decoration if we use it elsewhere
  });

  // IP Filtering Hook for /dl/ route
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.url.startsWith('/dl/')) {
        const remoteIp = request.ip;
        // Allow only 10.2.x.x (WireGuard Server/VPN Core) and 10.6.x.x (Mobile Devices)
        const isVpnRange = remoteIp.startsWith('10.2.') || remoteIp.startsWith('10.6.') || remoteIp === '127.0.0.1';
        
        if (!isVpnRange) {
            Logger.warn('Fastify', `REJECTED: Public attempt to access installers from ${remoteIp}`);
            reply.code(403).send({ error: 'Forbidden: Access restricted to internal VPN nodes.' });
            return reply;
        }
    }
  });

  fastify.addHook('preValidation', async (request, reply) => {
    if (request.method === 'OPTIONS') return; // Skip preflight
    if (request.url.startsWith('/ws/')) return;
    if (request.url.startsWith('/api/freellmapi-proxy/')) return; // Bypass auth for LLM proxy
    if (request.url.startsWith('/api/evolution/gitea/webhook')) return; // Allow Gitea webhooks
    const apiKey = request.headers['x-api-key'] as string;
    
    // Global API Key Check
    if (apiKey === config.server.apiKey) return;
    
    // Check against individual node keys
    if (config.auth?.keys && Object.values(config.auth.keys).includes(apiKey)) return;
    
    Logger.warn('Fastify', `Unauthorized request blocked from ${request.ip} to ${request.url}`);
    reply.code(401).send({ error: 'Unauthorized' });
    return reply;
  });

  fastify.register(nodeRoutes, { prefix: '/api/nodes' });
  fastify.register(chatRoutes, { prefix: '/api/chat' });
  fastify.register(kgRoutes, { prefix: '/api/kg' });
  fastify.register(documentRoutes, { prefix: '/api/documents', ingester } as any);
  fastify.register(feedRoutes, { prefix: '/api/feed' });
  fastify.register(adminRoutes, { prefix: '/api/admin' });
  fastify.register(agentRoutes, { prefix: '/api/agent' });
  fastify.register(releaseRoutes, { prefix: '/api/releases' });
  fastify.register(deliveryRoutes, { prefix: '/api/delivery' });
  fastify.register(aiTasksRoutes, { prefix: '/api/ai-tasks' });
  fastify.register(wikiRoutes, { prefix: '/api/wiki' });
  fastify.register(evolutionRoutes, { prefix: '/api/evolution' });
  fastify.register(webRoutes, { prefix: '/api/web' });
  fastify.register(syncRoutes, { prefix: '/api/sync' });
  fastify.register(kasmRoutes, { prefix: '/api/kasm' });
  fastify.register(localSttRoutes, { prefix: '/api/local-stt' });
  fastify.register(organizationRoutes, { prefix: '/api/organization' });
  fastify.register(researchRoutes, { prefix: '/api/research' });

  fastify.get('/api/health', async (request, reply) => {
    const { version } = require('../package.json');
    return { ok: true, version, status: 'ready' };
  });

  function normalizeMessages(messages: any[]): any[] {
    if (!Array.isArray(messages)) return messages;
    return messages.map((msg) => {
      if (!msg || typeof msg !== 'object') return msg;
      const clonedMsg = { ...msg };
      if (Array.isArray(clonedMsg.content)) {
        clonedMsg.content = clonedMsg.content
          .map((part: any) => {
            if (part && part.type === 'text' && typeof part.text === 'string') {
              return part.text;
            }
            return '';
          })
          .join('\n');
      }
      return clonedMsg;
    });
  }

  function sanitizeSchema(obj: any): void {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        sanitizeSchema(item);
      }
      return;
    }

    if ('additionalProperties' in obj) {
      delete obj.additionalProperties;
    }
    if ('patternProperties' in obj) {
      delete obj.patternProperties;
    }

    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object') {
        sanitizeSchema(obj[key]);
      }
    }
  }

  // OpenAI proxy route to forward OpenClaw requests to FreeLLMAPI after stripping the model param
  fastify.post('/api/freellmapi-proxy/v1/chat/completions', async (request, reply) => {
    const body = request.body as any;
    const authHeader = request.headers['authorization'];
    
    // Clone and strip 'model' from the request body to force FreeLLMAPI's internal routing/fallback
    const proxyBody = { ...body };
    delete proxyBody.model;
    
    if (proxyBody.messages) {
      proxyBody.messages = normalizeMessages(proxyBody.messages);
    }

    // Sanitize tools JSON schemas for Google Gemini models to avoid 400 Bad Request rejections
    const isGemini = body.model && typeof body.model === 'string' && body.model.toLowerCase().includes('gemini');
    if (isGemini && Array.isArray(proxyBody.tools)) {
      for (const tool of proxyBody.tools) {
        if (tool && tool.type === 'function' && tool.function && tool.function.parameters) {
          sanitizeSchema(tool.function.parameters);
        }
      }
    }

    Logger.info('FreeLLMAPI-Proxy', `Proxying chat completions from ${request.ip} (stripped model: ${body.model}). Payload: ${JSON.stringify(body)}`);

    const freellmapiUrl = `${config.freellmapi?.baseUrl || 'http://10.2.0.54:3001'}/v1/chat/completions`;

    try {
      if (body.stream) {
        const response = await axios({
          method: 'post',
          url: freellmapiUrl,
          data: proxyBody,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader || `Bearer ${config.freellmapi?.apiKey}`
          },
          responseType: 'stream'
        });

        reply.headers({
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        return response.data;
      } else {
        const response = await axios({
          method: 'post',
          url: freellmapiUrl,
          data: proxyBody,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader || `Bearer ${config.freellmapi?.apiKey}`
          }
        });
        
        reply.code(response.status).send(response.data);
      }
    } catch (err: any) {
      const status = err.response?.status || 500;
      const data = err.response?.data;
      
      let errorBody = '';
      if (data) {
        if (data && typeof data.on === 'function') {
          try {
            errorBody = await new Promise<string>((resolve) => {
              let buf = '';
              data.on('data', (chunk: any) => { buf += chunk.toString(); });
              data.on('end', () => resolve(buf));
              data.on('error', () => resolve('[Error reading stream]'));
            });
          } catch {
            errorBody = '[Failed to read stream]';
          }
        } else {
          errorBody = typeof data === 'object' ? JSON.stringify(data) : String(data);
        }
      }

      Logger.error('FreeLLMAPI-Proxy', `Proxy request failed with status ${status}: ${err.message}. Response data: ${errorBody || '[none]'}`);
      
      if (errorBody) {
        try {
          reply.code(status).header('Content-Type', 'application/json').send(JSON.parse(errorBody));
        } catch {
          reply.code(status).send(errorBody);
        }
      } else {
        reply.code(status).send({ error: err.message });
      }
    }
  });

  fastify.register(chatWs);
  fastify.register(statusWs);
  fastify.register(nodesWs);

  return fastify;
}

async function start() {
  try {
    Logger.info('Server', 'Initializing AIMindMesh Server Ecosystem...');
    
    try { 
      await initNeo4j(); 
      Logger.info('Neo4j', 'Connected to Graph Database successfully');
    } catch (e:any) { 
      Logger.error('Neo4j', `Connection failed: ${e.message || e}`); 
    }

    NodeRegistry.startMonitoring();
    await NodeRegistry.discoverAndRegisterLocalModels(config.ollama.baseUrl, config.ollama.defaultModel);
    ProactiveEngine.start();
    OpenClawHealthService.init();

    // Autonomous Organization Venture Discovery
    const { AutonomousVentureEngine } = require('./services/organization/AutonomousVentureEngine');
    AutonomousVentureEngine.start();
    
    // Setup background debate tasks
    const { DebateEngine } = require('./services/DebateEngine');
    DebateEngine.start();

    const { DeliveryScheduler } = require('./services/DeliveryScheduler');
    DeliveryScheduler.start();

    await checkConnectivity();
    await GiteaService.init();
    await InferenceRouter.init(); // Initialize the persistent inference queue
    await AiTaskScheduler.init();
    ingester.initialize();

    // Bootstrap Organization Layer
    try {
      const { OrganizationBootstrapService } = require('./services/organization/OrganizationBootstrapService');
      const { SQLiteOrganizationRoleRepository } = require('./services/organization/OrganizationRegistry');
      const roleRepo = new SQLiteOrganizationRoleRepository();
      const bootstrapRepo = {
        async upsertRole(role: any) {
          const id = `role-${role.name.toLowerCase().replace(/\s+/g, '-')}`;
          const existing = await roleRepo.findById(id);
          if (!existing) {
            await roleRepo.insert({
              ...role,
              id,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            });
          } else {
            await roleRepo.update(id, {
              description: role.description,
              mission: role.mission,
              systemPrompt: role.systemPrompt,
              toolPermissions: role.toolPermissions,
              canRecruit: role.canRecruit,
              canProposeRepo: role.canProposeRepo,
              canProvisionValidation: role.canProvisionValidation,
              updatedAt: new Date().toISOString()
            });
          }
        },
        async upsertDirective(directive: any) {
          const id = `directive-default`;
          const existing = db.prepare('SELECT * FROM organization_directives WHERE id = ?').get(id);
          if (!existing) {
            db.prepare(`
              INSERT INTO organization_directives (
                id, title, description, goal_type, constraints, priority, status, created_by, supersedes_id, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              id, directive.title, directive.description, directive.goalType, JSON.stringify(directive.constraints),
              directive.priority, directive.status, directive.createdBy, directive.supersedesId,
              new Date().toISOString(), new Date().toISOString()
            );
          } else {
            db.prepare(`
              UPDATE organization_directives
              SET title = ?, description = ?, goal_type = ?, priority = ?, updated_at = ?
              WHERE id = ?
            `).run(
              directive.title, directive.description, directive.goalType,
              directive.priority, new Date().toISOString(), id
            );
          }
        },
        async setSetting(key: string, value: string) {
          // placeholder setting trace
        },
        async log(eventType: string, payload: any) {
          const auditId = `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          db.prepare(`
            INSERT INTO organization_audit_log (id, event_type, actor_type, actor_id, target_type, target_id, payload, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(auditId, eventType, 'system', 'bootstrap', 'organization', 'system', JSON.stringify(payload), new Date().toISOString());
        }
      };
      const bootstrapService = new OrganizationBootstrapService(bootstrapRepo);
      await bootstrapService.bootstrap({
        organization: {
          enabled: true,
          name: "AIMindMesh Organization",
          owner: "director",
          defaultNamespace: "aimindmesh-labs",
          approvalMode: "human",
          allowAutoRoleCreation: false,
          allowAutoRepoCreation: false,
          allowAutoCiBootstrap: true,
          allowAutoValidation: true,
          defaultValidationMode: "smoke",
          auditEnabled: true,
          ideationEnabled: true,
          hrEnabled: true,
          giteaEnabled: true,
          kasmEnabled: true,
          searxngEnabled: true,
          offlineQueueEnabled: true,
          defaultCouncilRounds: 3,
          maxCouncilParticipants: 6,
          requireHumanApprovalForRepoCreation: true,
          requireHumanApprovalForRoleCreation: true,
          requireHumanApprovalForValidation: false,
          defaultDirective: {
            title: "Build privacy-first internal software tools",
            description: "Focus on software ideas, roles, and workflows aligned with privacy-first, self-hosted, and internal productivity goals.",
            goalType: "build",
            priority: 80,
            status: "active"
          }
        }
      });
      Logger.info('Organization', 'Bootstrap seeding completed successfully');
    } catch (e: any) {
      Logger.error('Organization', `Bootstrap failed: ${e.message}`);
    }

    // Neural Wiki
    const { WikiManager } = require('./services/WikiManager');
    const { WikiSynthesisService } = require('./services/WikiSynthesisService');
    await WikiManager.init(
      config.wiki?.storagePath ?? './data/wiki',
      config.wiki?.gitEnabled ?? false
    );
    WikiSynthesisService.start();
    // Auto-Evolution
    const { autoEvolutionPipeline } = require('./services/AutoEvolutionPipeline');
    const { ImprovementDetector } = require('./services/ImprovementDetector');
    ImprovementDetector.init();
    await autoEvolutionPipeline.init();
    
    // Start background enrichment recovery
    RecoveryService.start();
    
    // OpenRouter Credit Monitoring
    await OpenRouterService.init();

    const server = await build();
    await server.listen({ port: config.server.port, host: '0.0.0.0' });
    Logger.info('Server', `Fastify securely bound to container interface on port ${config.server.port}`);
  } catch (err: any) {
    Logger.error('Server', `Fatal boot error: ${err.message}`);
    process.exit(1);
  }
}

start();
