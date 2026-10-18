import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import axios from 'axios';
import { config } from '../../config';
import { Logger } from '../../utils/Logger';
import { isClaudeModel } from '../../services/inference/claude/claudeSettings';
import { claudeAgentRoute } from '../../services/inference/claude/agentBridge/agentClaudeGate';
import { serveWithClaude } from '../../services/inference/claude/agentBridge/serveWithClaude';
import { getBuildSettings } from '../../services/organization/venture/BuildSettings';

/**
 * OpenAI-compatible routes of the agents: OpenClaw and Hermes call the general route, venture
 * development runs the builder route. Claude answers them first (natively, with prompt
 * caching) while it has credit and the caller's key is accepted; otherwise, or when the Claude
 * call fails before its first byte, the request goes to FreeLLMAPI as before. Both routes are
 * self-authenticated (middleware/auth.ts): the caller's Bearer key is required.
 */
export function agentProxyRoutes(fastify: FastifyInstance): void {
  fastify.post('/api/freellmapi-proxy/v1/chat/completions', (request, reply) => proxyChatCompletions(request, reply, 'agent', null));
  fastify.post('/api/freellmapi-proxy/builder/v1/chat/completions', (request, reply) =>
    proxyChatCompletions(request, reply, 'builder', getBuildSettings().model));
}

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

async function proxyChatCompletions(request: FastifyRequest, reply: FastifyReply, source: 'agent' | 'builder', buildModel: string | null) {
  const body = request.body as any;
  const authHeader = request.headers['authorization'];

  // Callers (OpenClaw, Hermes) must present their own FreeLLMAPI key: the server key is never injected
  if (!authHeader) {
    Logger.warn('FreeLLMAPI-Proxy', `Rejected unauthenticated proxy request from ${request.ip}`);
    reply.code(401).send({ error: 'Missing Authorization header' });
    return reply;
  }

  const claude = claudeAgentRoute(source, authHeader, buildModel);
  if (claude && await serveWithClaude(request, reply, body, claude)) return reply;

  // A Claude build model means nothing to FreeLLMAPI: it routes the fallback itself
  const modelOverride = source === 'builder' && buildModel && !isClaudeModel(buildModel) ? buildModel : null;
  return forwardToFreeLLMAPI(request, reply, body, authHeader, modelOverride);
}

// The general route strips the model (FreeLLMAPI routes and falls back); the builder route applies
// the model chosen in the organization build settings, when there is one.
async function forwardToFreeLLMAPI(request: FastifyRequest, reply: FastifyReply, body: any, authHeader: string, modelOverride: string | null) {
  // Clone and strip 'model' from the request body to force FreeLLMAPI's internal routing/fallback
  const proxyBody = { ...body };
  delete proxyBody.model;
  if (modelOverride) proxyBody.model = modelOverride;

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

  Logger.info('FreeLLMAPI-Proxy', `Proxying chat completions from ${request.ip} (model: ${body.model} -> ${modelOverride ?? 'FreeLLMAPI routing'}, messages: ${Array.isArray(body.messages) ? body.messages.length : 0}, stream: ${!!body.stream})`);

  const freellmapiUrl = `${config.freellmapi?.baseUrl || 'http://10.2.0.54:3001'}/v1/chat/completions`;

  try {
    if (body.stream) {
      const response = await axios({
        method: 'post',
        url: freellmapiUrl,
        data: proxyBody,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader
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
          'Authorization': authHeader
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
}
