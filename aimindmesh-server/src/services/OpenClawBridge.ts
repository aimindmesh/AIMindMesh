import axios from 'axios';
import WebSocket from 'ws';
import dns from 'node:dns';
import { readFile, writeFile, mkdir } from 'fs/promises';
import crypto from 'node:crypto';
import path from 'path';
dns.setDefaultResultOrder('ipv4first');
import { Logger } from '../utils/Logger';
import { config } from '../config';
import { OpenClawHealthService } from './OpenClawHealthService';

const OPENCLAW_BASE = process.env.OPENCLAW_URL ?? 'http://openclaw-gateway:18789';
const OPENCLAW_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;

if (!OPENCLAW_TOKEN) {
  Logger.warn('OpenClawBridge', 'OPENCLAW_GATEWAY_TOKEN not set in environment. Agent functionality will be limited.');
}

const baseHeaders = {
  'Origin': OPENCLAW_BASE,
  'User-Agent': 'AIMindMesh-Server/1.x',
  'Accept': 'application/json',
};

const client = axios.create({
  baseURL: OPENCLAW_BASE,
  timeout: config.openclaw?.taskTimeoutMs ?? 3600000, // 1 hour
  headers: {
    ...baseHeaders,
    'Authorization': OPENCLAW_TOKEN ? `Bearer ${OPENCLAW_TOKEN}` : undefined,
  },
});

let ws: WebSocket | null = null;
let wsReady = false;
let wsConnecting = false;
let resolvedIp: string | null = null;
let isVersion2 = false;
// Maps to track pending operations
const pendingRpcs = new Map<string, (val: any) => void>();
const pendingRuns = new Map<string, { sessionKey: string, resolve: (val: any) => void, reject: (err: any) => void, timeout: NodeJS.Timeout }>();
const streamHandlers = new Map<string, (chunk: string) => void>();

export function isSessionActive(sessionKey: string): boolean {
  for (const [_, val] of pendingRuns) {
    if (val.sessionKey === sessionKey) {
      return true;
    }
  }
  return false;
}

const IDENTITY_FILE = '/app/data/bridge_identity_v2.json';

interface BridgeIdentity {
  id: string;
  publicKey: string;
  privateKey: string;
}

let bridgeIdentity: BridgeIdentity | null = null;

async function getBridgeIdentity(): Promise<BridgeIdentity> {
  if (bridgeIdentity) return bridgeIdentity;
  try {
    await mkdir(path.dirname(IDENTITY_FILE), { recursive: true });
    const content = await readFile(IDENTITY_FILE, 'utf-8');
    bridgeIdentity = JSON.parse(content);
    return bridgeIdentity!;
  } catch (e) {
    Logger.info('OpenClawBridge', 'Generating new Ed25519 cryptographic identity...');
    const keyPair = crypto.generateKeyPairSync('ed25519');
    const derPublicKey = keyPair.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    const rawPublicKey = derPublicKey.slice(12);
    const privateKeyPem = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const identity: BridgeIdentity = {
      id: crypto.createHash('sha256').update(rawPublicKey).digest('hex'),
      publicKey: rawPublicKey.toString('base64'),
      privateKey: privateKeyPem,
    };
    await writeFile(IDENTITY_FILE, JSON.stringify(identity, null, 2));
    bridgeIdentity = identity;
    return identity;
  }
}

function generateHandshakeSignature(
  identity: BridgeIdentity,
  clientId: string,
  mode: string,
  role: string,
  scopes: string[],
  ts: number,
  token: string,
  nonce: string
): string {
  // v2 canonical payload — source-verified order from device-auth.ts:
  // v2|deviceId|clientId|clientMode|role|scopes(NO sort)|signedAtMs|token|nonce
  const payload = [
    'v2',
    identity.id,
    clientId,
    mode,
    role,
    scopes.join(','),
    String(ts),
    token,
    nonce,
  ].join('|');
  Logger.debug('OpenClawBridge', 'Signing payload: ' + payload.substring(0, 100) + '...');
  return crypto.sign(null, Buffer.from(payload, 'utf8'), identity.privateKey).toString('base64');
}

let retryDelay = 5_000;
const MIN_RETRY_DELAY = 5_000;
const MAX_RETRY_DELAY = 5 * 60_000;

async function getGatewayAddress(): Promise<string> {
  const host = new URL(OPENCLAW_BASE).hostname;
  if (resolvedIp) return resolvedIp;
  try {
    const { address } = await dns.promises.lookup(host, { family: 4 });
    resolvedIp = address;
    Logger.info('OpenClawBridge', 'Resolved ' + host + ' to IPv4: ' + address);
    return address;
  } catch (e) {
    return host;
  }
}

async function connectWebSocket() {
  if (wsConnecting || wsReady) return;
  wsConnecting = true;

  const wsUrl = OPENCLAW_BASE.replace(/^http/, 'ws');
  Logger.info('OpenClawBridge', 'Establishing neural link to ' + wsUrl + '...');

  const wsHeaders: Record<string, string> = {
    ...baseHeaders,
    'Origin': 'http://10.2.0.50:3030',
    'X-Claw-Id': 'aimindmesh-server',
    'User-Agent': 'AIMindMesh-Server/1.x',
  };

  const validToken = !!(OPENCLAW_TOKEN && OPENCLAW_TOKEN !== 'undefined' && OPENCLAW_TOKEN.trim().length > 0);
  Logger.info('OpenClawBridge', 'Neural link handshake — Token valid: ' + validToken);

  if (validToken) {
    wsHeaders['X-Claw-Token'] = OPENCLAW_TOKEN!;
  }

  ws = new WebSocket(wsUrl, ['openclaw-p3'], {
    headers: wsHeaders,
    handshakeTimeout: 15000,
  });

  ws.on('open', () => {
    retryDelay = MIN_RETRY_DELAY;
    Logger.info('OpenClawBridge', 'Neural link socket open — Waiting for gateway challenge...');
  });

  ws.on('message', (data: WebSocket.RawData) => {
    const rawMessage = data.toString();
    Logger.debug('OpenClawBridge', '<<< INCOMING FRAME: ' + rawMessage);

    try {
      const msg = JSON.parse(rawMessage);

      if ((msg.type === 'evt' || msg.type === 'event') && msg.event === 'connect.challenge') {
        const nonce: string = msg.payload?.nonce;
        const challengeTs: number = msg.payload?.ts || Date.now();

        Logger.info('OpenClawBridge', 'Challenge received (nonce: ' + nonce?.substring(0, 8) + '...). Computing signature...');

        getBridgeIdentity()
          .then(identity => {
            const clientId = 'cli';
            const mode = 'backend';
            const role = 'operator';
            const scopes = [
              'operator.read',
              'operator.write',
              'operator.admin',
              'operator.approvals',
              'operator.pairing',
            ];
            const token = (OPENCLAW_TOKEN || '').trim();

            const signature = generateHandshakeSignature(
              identity,
              clientId,
              mode,
              role,
              scopes,
              challengeTs,
              token,
              nonce
            );

            Logger.info('OpenClawBridge', 'Sending connect frame — deviceId: ' + identity.id.substring(0, 16) + '...');

            const connectParams = {
              minProtocol: 4,
              maxProtocol: 4,
              client: {
                id: clientId,
                mode: mode,
                platform: 'linux',
                version: '1.0.0',
              },
              role: role,
              scopes,
              caps: [],
              commands: [],
              permissions: {},
              auth: { token },
              device: {
                id: identity.id,
                publicKey: identity.publicKey,
                signature,
                signedAt: challengeTs,
                nonce,
              },
              locale: 'en-US',
              userAgent: 'AIMindMesh-Server/1.x',
            };

            ws?.send(JSON.stringify({
              type: 'req',
              id: 'handshake-' + Math.random().toString(36).substring(7),
              method: 'connect',
              params: connectParams,
            }));
          })
          .catch((err: any) => {
            Logger.error('OpenClawBridge', 'Failed to generate identity or signature: ' + err.message);
            ws?.close();
          });

        return;
      }

      if (msg.type === 'res' && msg.id?.startsWith('handshake-')) {
        if (msg.ok) {
          wsReady = true;
          wsConnecting = false;
          const grantedScopes = msg.payload?.auth?.scopes || msg.result?.auth?.scopes;
          Logger.info('OpenClawBridge', 'Neural link established! — Granted Scopes: ' + JSON.stringify(grantedScopes));
          Logger.debug('OpenClawBridge', 'Full Handshake Payload: ' + JSON.stringify(msg.payload || msg.result));
        } else {
          Logger.error('OpenClawBridge', 'Handshake rejected by gateway: ' + JSON.stringify(msg.error));
          ws?.close();
        }
        return;
      }

      if (msg.type === 'res' || msg.type === 'result') {
        const handler = pendingRpcs.get(msg.id);
        if (handler) {
          if (msg.ok === false) {
            handler({ error: msg.error?.message || 'RPC Failed' });
          } else {
            handler(msg.result || msg.payload || msg);
          }
          pendingRpcs.delete(msg.id);
        }
        return;
      }

      if (msg.type === 'evt' || msg.type === 'event') {
        const eventName = msg.event || msg.kind;
        const payload = msg.payload || {};
        const rawSessionKey = payload.sessionKey || msg.sessionKey;

        if (rawSessionKey) {
          // Normalize session key: "agent:main:proactive-engine" -> "proactive-engine"
          const sessionKey = rawSessionKey.includes(':')
            ? rawSessionKey.split(':').pop()
            : rawSessionKey;

          const handler = streamHandlers.get(sessionKey);
          if (handler) {
            // Protocol 4: agent event with stream: assistant
            if (eventName === 'agent' && payload.stream === 'assistant' && payload.data?.delta) {
              handler(payload.data.delta);
            }
            // Protocol 4: chat event with state: delta
            else if (eventName === 'chat' && payload.state === 'delta' && payload.message?.content?.[0]?.text) {
              const text = payload.message.content[0].text;
              handler(text);
              
              // Protocol 4: If we get text and the runId is present, we might be near the end
              if (msg.payload?.runId) {
                const pending = pendingRuns.get(msg.payload.runId);
                // We don't resolve yet, but we could if we see a specific termination string
              }
            }
            // Legacy / Protocol 1-2
            else if (eventName === 'transcriptUpdate' && payload.delta) {
              handler(payload.delta);
            }
          }
        }

        // Handle agent lifecycle events (Run completion/error)
        if (eventName === 'agent' && payload.stream === 'lifecycle' && payload.runId) {
          const runId = payload.runId;
          const pending = pendingRuns.get(runId);
          if (pending) {
            const data = payload.data || {};
            if (data.phase === 'end') {
              pending.resolve(data.output || 'Task completed successfully.');
              pendingRuns.delete(runId);
            } else if (data.phase === 'error') {
              // Instead of rejecting, resolve with an error message so the UI shows it
              pending.resolve(`⚠️ AGENT ERROR: ${data.error || 'Execution failed'}`);
              pendingRuns.delete(runId);
            }
          }
        }
        
        // Protocol 4: Handle agent events with status "completed" or "failed"
        if (eventName === 'agent' && (payload.status === 'completed' || payload.status === 'failed')) {
          const runId = payload.runId;
          const pending = pendingRuns.get(runId);
          if (pending) {
            pending.resolve(payload.output || 'Task finalized.');
            pendingRuns.delete(runId);
          }
        }
      }
    } catch (e) {
      // parse error ignored
    }
  });

  ws.on('close', (code: number, reason: Buffer) => {
    wsReady = false;
    wsConnecting = false;
    Logger.warn('OpenClawBridge', 'Neural link terminated (Code: ' + code + ', Reason: ' + (reason.toString() || 'None') + '). Retrying in ' + (retryDelay / 1000) + 's...');
    setTimeout(() => {
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
      connectWebSocket();
    }, retryDelay);
  });

  ws.on('error', (err: Error) => {
    Logger.error('OpenClawBridge', 'Synaptic failure: ' + err.message);
    wsReady = false;
    wsConnecting = false;
  });
}

async function callOpenClawRpc(method: string, params: any): Promise<any> {
  if (!wsReady || !ws) {
    throw new Error('OpenClaw WebSocket not ready');
  }
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRpcs.delete(requestId);
      reject(new Error('RPC Timeout: ' + method));
    }, 3600000); // 1 hour
    pendingRpcs.set(requestId, (result: any) => {
      clearTimeout(timeout);
      resolve(result);
    });
    ws!.send(JSON.stringify({
      type: 'req',
      id: requestId,
      method,
      params,
    }));
  });
}

export async function runTask(prompt: string, sessionKey: string): Promise<AgentTaskResult> {
  if (!wsReady) throw new Error('OpenClaw gateway not connected');

  const startTime = Date.now();
  Logger.info('OpenClawBridge', `Starting agent task for session ${sessionKey}: ${prompt.substring(0, 50)}...`);

  try {
    // 1. Pro-active Quota/Health validation (DEDICATED TO OPENCLAW)
    await OpenClawHealthService.validateExecution();

    const res = await callOpenClawRpc('agent', {
      message: prompt,
      sessionKey: sessionKey,
      deliver: false,
      idempotencyKey: crypto.randomUUID(),
    });

    const runId = res.runId || res.payload?.runId || res.result?.runId;
    if (res.error) {
      throw new Error(`OpenClaw Gateway Error: ${res.error}`);
    }
    if (!runId) {
      throw new Error(`Failed to start agent run: no runId returned. Response: ${JSON.stringify(res)}`);
    }

    // Wait for the run to complete via WebSocket events
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRuns.delete(runId);
        reject(new Error('Agent task timed out after 5 minutes'));
      }, 300000); // 5 minute timeout

      pendingRuns.set(runId, {
        sessionKey,
        resolve: (finalReply: string) => {
          clearTimeout(timeout);
          resolve({
            reply: finalReply,
            sessionKey,
            durationMs: Date.now() - startTime,
            usedModel: config.gemini?.model || 'gemini-3.1-flash-lite-preview'
          });
        },
        reject: (err: any) => {
          clearTimeout(timeout);
          reject(err);
        },
        timeout
      });
    });

  } catch (err: any) {
    // 2. Reactive failure tracking
    OpenClawHealthService.markFailure(err.message);
    
    Logger.error('OpenClawBridge', 'Task execution failed: ' + err.message);
    throw err;
  }
}

connectWebSocket();

const CONFIG_PATH = '/app/openclaw-config';

export interface AgentTaskResult {
  reply: string;
  sessionKey: string;
  durationMs: number;
  usedModel?: string;
}

export interface OpenClawStatus {
  available: boolean;
  version: string;
  activeSessions: number;
  cronJobs: number;
  skills: string[];
  config?: any;
}

export interface CronJob {
  id: string;
  schedule: string;
  task: string;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
}

export interface Skill {
  name: string;
  version: string;
  description: string;
  trigger: string;
}

interface StatusV1Response extends OpenClawStatus { }

interface AgentResponse {
  reply?: string;
  content?: string;
  model?: string;
}

interface HistoryResponse {
  messages: Array<{ role: string; content: string; timestamp: string }>;
}

interface SkillsResponse {
  skills: Skill[];
}

interface CronResponse {
  jobs: CronJob[];
}

export async function getStatus(): Promise<OpenClawStatus | null> {
  if (wsReady) {
    return {
      available: true,
      version: 'Connected (Protocol 4 / operator)',
      activeSessions: 0,
      cronJobs: 0,
      skills: [],
    };
  }
  try {
    const res = await client.get('/api/status').catch(async e => {
      if (e.response?.status === 404) {
        return await client.get('/api/v1/status');
      }
      throw e;
    });
    const data = res.data as any;
    if (data.config?.gateway) isVersion2 = false;
    if (data.version?.startsWith('2')) isVersion2 = true;
    if (res.status === 200 && !data.version) isVersion2 = true;
    return data as OpenClawStatus;
  } catch (err: any) {
    if (err.response?.status === 404) {
      try {
        const resV1 = await client.get('/api/v1/status');
        if (resV1.status === 200) {
          isVersion2 = true;
          const v1data = resV1.data as any;
          return {
            ...v1data,
            version: v1data.version || '2.x (Verified)',
          } as OpenClawStatus;
        }
      } catch (e2) { }
    }
    try {
      const resRoot = await client.get('/');
      if (resRoot.status === 200) {
        isVersion2 = true;
        Logger.info('OpenClawBridge', 'Gateway reached at ' + OPENCLAW_BASE + ' (Dashboard OK / API 2.x inferred)');
        return {
          available: true,
          version: '2.x (Bridge Fallback)',
          activeSessions: 0,
          cronJobs: 0,
          skills: [],
        };
      }
    } catch (e3) { }
    Logger.error('OpenClawBridge', 'Status check failed at ' + OPENCLAW_BASE + ': ' + err.message);
    return null;
  }
}

export async function isReachable(): Promise<boolean> {
  return (await getStatus()) !== null;
}

export async function runAgentTask(
  prompt: string,
  sessionKey = 'system',
  options: any = {},
): Promise<AgentTaskResult> {
  return runTask(prompt, sessionKey);
}

export async function* streamAgentTask(
  prompt: string,
  sessionKey = 'system',
): AsyncGenerator<string> {
  if (wsReady && ws) {
    Logger.info('OpenClawBridge', 'Starting stream via WebSocket for session ' + sessionKey);
    const queue: string[] = [];
    let isDone = false;

    streamHandlers.set(sessionKey, (chunk) => {
      queue.push(chunk);
    });

    ws.send(JSON.stringify({
      type: 'req',
      id: 'stream-' + Math.random().toString(36).substring(7),
      method: 'agent',
      params: {
        sessionKey,
        message: prompt,
        stream: true,
        idempotencyKey: crypto.randomUUID(),
      },
    }));

    const completionListener = (data: WebSocket.RawData) => {
      try {
        Logger.debug('OpenClawBridge', '<<< INCOMING FRAME: ' + data.toString());
        const msg = JSON.parse(data.toString());
        if (msg.sessionKey === sessionKey && (msg.payload?.status === 'completed' || msg.payload?.data?.phase === 'end' || (msg.event === 'agent' && msg.payload?.status === 'completed'))) {
          isDone = true;
          ws?.off('message', completionListener);
        }
      } catch (e) { }
    };

    ws.on('message', completionListener);

    while (!isDone || queue.length > 0) {
      if (queue.length > 0) {
        yield queue.shift()!;
      } else {
        await new Promise(r => setTimeout(r, 50));
      }
    }

    streamHandlers.delete(sessionKey);
    return;
  }

  const res = await runAgentTask(prompt, sessionKey);
  yield res.reply;
}

function normalizeMessages(messages: any[]): any[] {
  if (!Array.isArray(messages)) return [];
  return messages.map((msg) => {
    if (!msg || typeof msg !== 'object') return msg;
    const clonedMsg = { ...msg };
    if (Array.isArray(clonedMsg.content)) {
      clonedMsg.content = clonedMsg.content
        .map((part: any) => {
          if (typeof part === 'string') return part;
          if (part && typeof part === 'object') {
            if (part.type === 'text' && typeof part.text === 'string') {
              return part.text;
            }
            return JSON.stringify(part);
          }
          return '';
        })
        .join('\n');
    } else if (clonedMsg.content && typeof clonedMsg.content === 'object') {
      clonedMsg.content = JSON.stringify(clonedMsg.content);
    }
    return clonedMsg;
  });
}

export async function getSessionHistory(sessionKey: string) {
  if (wsReady) {
    const res = await callOpenClawRpc('chat.history', { sessionKey, limit: 1000 });
    return normalizeMessages(res.messages || []);
  }
  const apiPath = isVersion2
    ? `/api/v1/agents/main/sessions/${sessionKey}/history`
    : '/api/sessions/' + sessionKey + '/history';
  const res = await client.get(apiPath);
  return (res.data as any).messages;
}

export async function clearSession(sessionKey: string): Promise<void> {
  if (wsReady) {
    await callOpenClawRpc('sessions.delete', { key: sessionKey, deleteTranscript: true });
    return;
  }
  const apiPath = isVersion2
    ? `/api/v1/agents/main/sessions/${sessionKey}`
    : '/api/sessions/' + sessionKey;
  await client.delete(apiPath);
}

export async function listSkills(): Promise<Skill[]> {
  if (wsReady) {
    try {
      // In Protocol 4, skills.status gives the current state of loaded skills
      const res = await callOpenClawRpc('skills.status', { agentId: 'main' });
      const skills = res.skills || res.payload?.skills || res.data?.skills || [];
      return skills as Skill[];
    } catch (err: any) {
      Logger.warn('OpenClawBridge', 'Failed to list skills via WS RPC (skills.status): ' + err.message);
    }
  }
  return [];
}

export async function runSkill(skillName: string, input: Record<string, any>) {
  const prompt = JSON.stringify({ skill: skillName, input });
  return runAgentTask(prompt, 'aimindmesh:skills');
}

export async function listCronJobs(): Promise<CronJob[]> {
  if (wsReady) {
    try {
      const res = await callOpenClawRpc('agents.cron.list', { agentId: 'main' });
      return (res.jobs || res.payload?.jobs || []) as CronJob[];
    } catch (err: any) {
      Logger.warn('OpenClawBridge', 'Failed to list cron jobs via WS: ' + err.message);
    }
  }
  const apiPath = isVersion2 ? '/api/v1/cron' : '/api/cron';
  try {
    const res = await client.get(apiPath);
    return (res.data as any).jobs || [];
  } catch (err) {
    return [];
  }
}

export async function createCronJob(schedule: string, task: string): Promise<CronJob> {
  const res = await client.post('/api/cron', { schedule, task });
  return res.data as CronJob;
}

export async function deleteCronJob(id: string): Promise<void> {
  await client.delete('/api/cron/' + id);
}

export async function toggleCronJob(id: string, enabled: boolean): Promise<CronJob> {
  const res = await client.patch('/api/cron/' + id, { enabled });
  return res.data as CronJob;
}

export async function getMdFile(filename: 'soul' | 'identity' | 'agents' | 'memory') {
  try {
    const pathMap = {
      soul: 'SOUL.md',
      identity: 'IDENTITY.md',
      agents: 'AGENTS.md',
      memory: 'MEMORY.md',
    };
    // Protocol 4 uses 'name' for the file path relative to workspace
    const res = await callOpenClawRpc('agents.files.get', {
      agentId: 'main',
      name: pathMap[filename],
    });
    // Response structure: { file: { content: "...", name: "..." } }
    const file = res.file || res.payload?.file || res.data?.file;
    return (file?.content || '') as string;
  } catch (err: any) {
    Logger.error('OpenClawBridge', 'Failed to read config via WS RPC for ' + filename + ': ' + err.message);
    return '';
  }
}

export async function saveMdFile(
  filename: 'soul' | 'identity' | 'agents' | 'memory',
  content: string,
): Promise<void> {
  try {
    const pathMap = {
      soul: 'workspace/SOUL.md',
      identity: 'workspace/IDENTITY.md',
      agents: 'workspace/AGENTS.md',
      memory: 'workspace/MEMORY.md',
    };
    await callOpenClawRpc('agents.files.set', {
      agentId: 'main',
      path: pathMap[filename],
      content,
    });
    Logger.info('OpenClawBridge', 'Successfully synced config ' + filename + ' with OpenClaw Gateway via WS RPC.');
  } catch (err: any) {
    Logger.error('OpenClawBridge', 'Failed to sync config via WS RPC for ' + filename + ': ' + err.message);
    throw err;
  }
}