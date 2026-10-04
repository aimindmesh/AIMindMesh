import crypto from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config';
import { Logger } from '../utils/Logger';

/**
 * Constant-time string comparison (avoids leaking key prefixes via timing).
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Checks a key against the global server key and the per-node keys.
 */
export function isValidApiKey(key?: string): boolean {
  if (!key) return false;
  const validKeys = [config.server.apiKey, ...Object.values(config.auth?.keys ?? {})];
  return validKeys.some(k => typeof k === 'string' && k.length > 0 && safeEqual(key, k));
}

/**
 * Reads the API key from the `x-api-key` header.
 * For WebSocket upgrades (`/ws/*`) the `token` query param is also accepted,
 * since browser WebSockets cannot set custom headers.
 */
export function extractApiKey(request: FastifyRequest): string | undefined {
  const header = request.headers['x-api-key'];
  if (typeof header === 'string' && header) return header;

  if (request.url.startsWith('/ws/')) {
    const token = (request.query as Record<string, unknown> | undefined)?.token;
    if (typeof token === 'string' && token) return token;
  }
  return undefined;
}

/**
 * Masks credentials passed in the query string before an URL is logged.
 */
export function redactUrl(url: string): string {
  return url.replace(/([?&](?:token|apiKey|api_key)=)[^&]*/gi, '$1***');
}

// Routes that carry their own credentials: Bearer key (LLM proxy) or HMAC signature (Gitea webhooks)
const SELF_AUTHENTICATED_ROUTES = new Set([
  '/api/freellmapi-proxy/v1/chat/completions',
  '/api/freellmapi-proxy/builder/v1/chat/completions',
  '/api/evolution/gitea/webhook',
  '/api/organization/webhooks/gitea',
]);

/**
 * Global preValidation hook: every route needs a valid API key unless listed above.
 * Exemptions match the registered route pattern, never the raw URL.
 * WebSocket upgrades (/ws/*) go through this hook too: a 401 here rejects the handshake.
 */
export async function authHook(request: FastifyRequest, reply: FastifyReply) {
  if (request.method === 'OPTIONS') return; // Skip preflight
  const route = request.routeOptions?.url;
  if (route && SELF_AUTHENTICATED_ROUTES.has(route)) return;
  // Installers are plain links: GET only, still behind the /dl/ VPN IP filter and the VPN-only port binding
  if (route === '/dl/*' && (request.method === 'GET' || request.method === 'HEAD')) return;

  if (isValidApiKey(extractApiKey(request))) return;

  Logger.warn('Fastify', `Unauthorized request blocked from ${request.ip} to ${redactUrl(request.url)}`);
  reply.code(401).send({ error: 'Unauthorized' });
  return reply;
}
