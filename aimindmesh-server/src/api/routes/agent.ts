import { FastifyInstance } from 'fastify';
import fs from 'fs/promises';
import path from 'path';
import * as OpenClawBridge from '../../services/OpenClawBridge';
import { HermesBridge } from '../../services/HermesBridge';
import { Logger } from '../../utils/Logger';

const OPENCLAW_CONFIG_DIR = '/app/openclaw-config';
const OPENCLAW_JSON = path.join(OPENCLAW_CONFIG_DIR, 'openclaw.json');
const OPENCLAW_ENV = path.join(OPENCLAW_CONFIG_DIR, '.env');

const HERMES_CONFIG_DIR = '/app/hermes-data';
const HERMES_YAML = path.join(HERMES_CONFIG_DIR, 'config.yaml');
const HERMES_ENV = path.join(HERMES_CONFIG_DIR, '.env');

// ── Helpers ──────────────────────────────────────────────────────────────────

async function readOpenClawJson(): Promise<any> {
  const raw = await fs.readFile(OPENCLAW_JSON, 'utf-8');
  return JSON.parse(raw);
}

async function writeOpenClawJson(data: any): Promise<void> {
  data.meta = { ...data.meta, lastTouchedAt: new Date().toISOString() };
  await fs.writeFile(OPENCLAW_JSON, JSON.stringify(data, null, 2), 'utf-8');
}

async function readEnvKey(key: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(OPENCLAW_ENV, 'utf-8');
    const match = raw.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return match ? match[1].trim() : undefined;
  } catch {
    return undefined;
  }
}

async function writeEnvKey(key: string, value: string): Promise<void> {
  let raw = '';
  try { raw = await fs.readFile(OPENCLAW_ENV, 'utf-8'); } catch { /* new file */ }
  const exists = new RegExp(`^${key}=.*$`, 'm').test(raw);
  if (exists) {
    raw = raw.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
  } else {
    raw = raw ? `${raw}\n${key}=${value}` : `${key}=${value}`;
  }
  await fs.writeFile(OPENCLAW_ENV, raw, 'utf-8');
}

// ── Routes ───────────────────────────────────────────────────────────────────

export default async function agentRoutes(fastify: FastifyInstance) {

  // ── Status ───────────────────────────────────────────────────────

  fastify.get('/status', async () => {
    const status = await OpenClawBridge.getStatus();
    if (!status) return { available: false };
    return status;
  });

  // ── Run agent task (non-streaming) ───────────────────────────────

  fastify.post<{
    Body: { prompt: string; sessionKey?: string; provider?: 'openclaw' | 'hermes' };
  }>('/task', async (req, reply) => {
    const { prompt, sessionKey = 'system', provider } = req.body;
    if (!prompt) return reply.status(400).send({ error: 'prompt required' });
    try {
      if (provider === 'hermes') {
        const result = await HermesBridge.runAgentTask(prompt, sessionKey);
        return result;
      } else {
        const result = await OpenClawBridge.runAgentTask(prompt, sessionKey);
        return result;
      }
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // ── Stream agent task (SSE) ───────────────────────────────────────

  fastify.post<{
    Body: { prompt: string; sessionKey?: string; provider?: 'openclaw' | 'hermes' };
  }>('/task/stream', async (req, reply) => {
    const { prompt, sessionKey = 'system', provider } = req.body;
    if (!prompt) return reply.status(400).send({ error: 'prompt required' });

    // SSE uses reply.raw directly, bypassing @fastify/cors — set CORS headers manually
    // so Capacitor WebView (origin: http://localhost) can read the stream.
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    reply.raw.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, Authorization');
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');

    try {
      if (provider === 'hermes') {
        for await (const delta of HermesBridge.streamAgentTask(prompt, sessionKey)) {
          reply.raw.write(`data: ${JSON.stringify({ delta })}\n\n`);
        }
      } else {
        for await (const delta of OpenClawBridge.streamAgentTask(prompt, sessionKey)) {
          reply.raw.write(`data: ${JSON.stringify({ delta })}\n\n`);
        }
      }
      reply.raw.write('data: [DONE]\n\n');
    } catch (err: any) {
      reply.raw.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    } finally {
      reply.raw.end();
    }
  });

  // ── Hermes Agent Specific Endpoints ───────────────────────────────

  fastify.get('/hermes/status', async () => {
    const reachable = await HermesBridge.isReachable();
    return { available: reachable, version: reachable ? '1.x (OpenAI API)' : 'Offline' };
  });

  fastify.get('/hermes/config', async (req, reply) => {
    try {
      let configYaml = '';
      let envFile = '';
      try {
        configYaml = await fs.readFile(HERMES_YAML, 'utf-8');
      } catch (e) {
        Logger.warn('Agent', `Hermes config.yaml not found at ${HERMES_YAML}`);
      }
      try {
        envFile = await fs.readFile(HERMES_ENV, 'utf-8');
      } catch (e) {
        Logger.warn('Agent', `Hermes .env not found at ${HERMES_ENV}`);
      }
      return { configYaml, envFile };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  fastify.put<{
    Body: { configYaml: string; envFile: string };
  }>('/hermes/config', async (req, reply) => {
    try {
      const { configYaml, envFile } = req.body;
      await fs.mkdir(HERMES_CONFIG_DIR, { recursive: true });
      await fs.writeFile(HERMES_YAML, configYaml, 'utf-8');
      await fs.writeFile(HERMES_ENV, envFile, 'utf-8');
      Logger.info('Agent', 'Successfully updated Hermes Agent configuration files.');
      return { ok: true };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // ── Session management ───────────────────────────────────────────

  fastify.get<{
    Params: { sessionKey: string };
  }>('/sessions/:sessionKey/history', async (req) => {
    return OpenClawBridge.getSessionHistory(req.params.sessionKey);
  });

  fastify.get<{
    Params: { sessionKey: string };
  }>('/sessions/:sessionKey/status', async (req) => {
    return { active: OpenClawBridge.isSessionActive(req.params.sessionKey) };
  });

  fastify.delete<{
    Params: { sessionKey: string };
  }>('/sessions/:sessionKey', async (req) => {
    await OpenClawBridge.clearSession(req.params.sessionKey);
    return { ok: true };
  });

  // ── Skills ────────────────────────────────────────────────────────

  fastify.get('/skills', async () => {
    return { skills: await OpenClawBridge.listSkills() };
  });

  fastify.post<{
    Body: { skillName: string; input: Record<string, unknown> };
  }>('/skills/run', async (req) => {
    return OpenClawBridge.runSkill(req.body.skillName, req.body.input);
  });

  // ── Cron jobs ─────────────────────────────────────────────────────

  fastify.get('/cron', async () => {
    return { jobs: await OpenClawBridge.listCronJobs() };
  });

  fastify.post<{
    Body: { schedule: string; task: string };
  }>('/cron', async (req, reply) => {
    const job = await OpenClawBridge.createCronJob(req.body.schedule, req.body.task);
    return reply.status(201).send(job);
  });

  fastify.delete<{
    Params: { id: string };
  }>('/cron/:id', async (req) => {
    await OpenClawBridge.deleteCronJob(req.params.id);
    return { ok: true };
  });

  fastify.patch<{
    Params: { id: string };
    Body: { enabled: boolean };
  }>('/cron/:id', async (req) => {
    return OpenClawBridge.toggleCronJob(req.params.id, req.body.enabled);
  });

  // ── Config .md files ──────────────────────────────────────────────

  fastify.get<{
    Params: { filename: string };
  }>('/config/:filename', async (req, reply) => {
    const valid = ['soul', 'identity', 'agents', 'memory'];
    if (!valid.includes(req.params.filename))
      return reply.status(400).send({ error: 'invalid filename' });
    const content = await OpenClawBridge.getMdFile(
      req.params.filename as 'soul' | 'identity' | 'agents' | 'memory',
    );
    return { filename: req.params.filename, content };
  });

  fastify.put<{
    Params: { filename: string };
    Body: { content: string };
  }>('/config/:filename', async (req, reply) => {
    const valid = ['soul', 'identity', 'agents', 'memory'];
    if (!valid.includes(req.params.filename))
      return reply.status(400).send({ error: 'invalid filename' });
    await OpenClawBridge.saveMdFile(
      req.params.filename as 'soul' | 'identity' | 'agents' | 'memory',
      req.body.content,
    );
    return { ok: true };
  });

  // ── Google Auth Configuration ──────────────────────────────────────

  fastify.get('/openclaw/google-auth', async (_req, reply) => {
    try {
      const cfg = await readOpenClawJson();
      const profile = cfg?.auth?.profiles?.['google:default'] ?? {};
      const apiKeyRaw = await readEnvKey('GOOGLE_API_KEY') ?? await readEnvKey('GEMINI_API_KEY');
      // Mask the key — show only last 4 chars
      const apiKeyMasked = apiKeyRaw
        ? `${'*'.repeat(Math.max(0, apiKeyRaw.length - 4))}${apiKeyRaw.slice(-4)}`
        : null;
      const primaryModel: string = cfg?.agents?.defaults?.model?.primary ?? 'google/gemini-3.1-flash-lite-preview';

      return {
        mode: profile.mode ?? 'api_key',      // 'api_key' | 'oauth'
        apiKeyMasked,
        hasApiKey: !!apiKeyRaw,
        primaryModel,
      };
    } catch (err: any) {
      Logger.error('Agent', `Failed to read google-auth config: ${err.message}`);
      return reply.status(500).send({ error: err.message });
    }
  });

  fastify.put<{
    Body: {
      mode: 'api_key' | 'oauth';
      apiKey?: string;
      primaryModel?: string;
    };
  }>('/openclaw/google-auth', async (req, reply) => {
    const { mode, apiKey, primaryModel } = req.body;
    if (!['api_key', 'oauth'].includes(mode))
      return reply.status(400).send({ error: "mode must be 'api_key' or 'oauth'" });

    try {
      const cfg = await readOpenClawJson();

      // Ensure nested objects exist
      cfg.auth ??= {};
      cfg.auth.profiles ??= {};
      cfg.auth.profiles['google:default'] ??= { provider: 'google' };
      cfg.agents ??= {};
      cfg.agents.defaults ??= {};
      cfg.agents.defaults.model ??= {};
      cfg.plugins ??= {};
      cfg.plugins.entries ??= {};

      if (mode === 'api_key') {
        // Write API Key to .env
        if (apiKey && apiKey.trim() && !apiKey.includes('*')) {
          await writeEnvKey('GOOGLE_API_KEY', apiKey.trim());
          await writeEnvKey('GEMINI_API_KEY', apiKey.trim());
        }
        // Update profile
        cfg.auth.profiles['google:default'] = { provider: 'google', mode: 'api_key' };
        // Update default model (use google/ prefix)
        const model = primaryModel?.startsWith('google/') ? primaryModel : `google/${primaryModel ?? 'gemini-3.1-flash-lite-preview'}`;
        cfg.agents.defaults.model.primary = model;
        // Ensure google plugin is enabled
        cfg.plugins.entries['google'] = { enabled: true };

      } else {
        // OAuth (Gemini CLI) mode
        cfg.auth.profiles['google:default'] = { provider: 'google-gemini-cli', mode: 'oauth' };
        // Set gemini-cli default model
        cfg.agents.defaults.model.primary = primaryModel ?? 'google-gemini-cli/gemini-3.1-flash-lite-preview';
        // Enable google plugin
        cfg.plugins.entries['google'] = { enabled: true };
      }

      await writeOpenClawJson(cfg);
      Logger.info('Agent', `OpenClaw Google auth updated → mode: ${mode}`);
      return { ok: true, mode, requiresRestart: true };
    } catch (err: any) {
      Logger.error('Agent', `Failed to update google-auth config: ${err.message}`);
      return reply.status(500).send({ error: err.message });
    }
  });

  // ── OpenClaw Workspace File Explorer Endpoints ────────────────────────────

  const getWorkspaceDir = async () => {
    const defaultPath = '/app/openclaw-workspace';
    try {
      await fs.access(defaultPath);
      return defaultPath;
    } catch {
      return path.resolve(__dirname, '../../../openclaw-workspace');
    }
  };

  async function getFilesRecursively(dir: string, baseDir: string): Promise<any[]> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const files = await Promise.all(
        entries.map(async (entry) => {
          const resPath = path.join(dir, entry.name);
          const relPath = path.relative(baseDir, resPath);
          
          if (!resPath.startsWith(baseDir)) {
            return null;
          }

          try {
            const stats = await fs.stat(resPath);
            if (entry.isDirectory()) {
              const subFiles = await getFilesRecursively(resPath, baseDir);
              return [
                {
                  name: entry.name,
                  path: relPath,
                  isDirectory: true,
                  size: 0,
                  mtime: stats.mtime.toISOString(),
                },
                ...subFiles,
              ];
            } else {
              return {
                name: entry.name,
                path: relPath,
                isDirectory: false,
                size: stats.size,
                mtime: stats.mtime.toISOString(),
              };
            }
          } catch {
            return null;
          }
        })
      );
      return files.flat().filter(Boolean) as any[];
    } catch {
      return [];
    }
  }

  fastify.get('/workspace/files', async () => {
    const wdir = await getWorkspaceDir();
    await fs.mkdir(wdir, { recursive: true });
    const list = await getFilesRecursively(wdir, wdir);
    return { files: list };
  });

  fastify.get<{
    Querystring: { path: string; download?: string };
  }>('/workspace/file', async (req, reply) => {
    const relPath = req.query.path;
    if (!relPath) return reply.status(400).send({ error: 'path parameter required' });
    
    const wdir = await getWorkspaceDir();
    const targetPath = path.resolve(wdir, relPath);
    if (!targetPath.startsWith(path.resolve(wdir))) {
      return reply.status(403).send({ error: 'Access denied: Path traversal attempt detected' });
    }

    try {
      const stats = await fs.stat(targetPath);
      if (stats.isDirectory()) {
        if (req.query.download === 'true') {
          const { spawn } = require('child_process');
          reply.header('Content-Disposition', `attachment; filename="${path.basename(targetPath)}.tar.gz"`);
          reply.header('Content-Type', 'application/gzip');
          const tar = spawn('tar', ['-czf', '-', '-C', path.dirname(targetPath), path.basename(targetPath)]);
          return reply.send(tar.stdout);
        }
        return reply.status(400).send({ error: 'Specified path is a directory' });
      }

      if (req.query.download === 'true') {
        const fileBuffer = await fs.readFile(targetPath);
        reply.header('Content-Disposition', `attachment; filename="${path.basename(targetPath)}"`);
        reply.header('Content-Type', 'application/octet-stream');
        return reply.send(fileBuffer);
      }

      const ext = path.extname(targetPath).toLowerCase();
      const textExtensions = ['.txt', '.md', '.json', '.js', '.ts', '.py', '.yaml', '.yml', '.ini', '.conf', '.env', '.html', '.css', '.sh', '.dockerfile'];

      if (textExtensions.includes(ext)) {
        const content = await fs.readFile(targetPath, 'utf-8');
        return { path: relPath, content, isText: true, size: stats.size };
      } else {
        return { path: relPath, isText: false, size: stats.size };
      }
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  fastify.put<{
    Body: { path: string; content: string };
  }>('/workspace/file', async (req, reply) => {
    const { path: relPath, content } = req.body;
    if (!relPath) return reply.status(400).send({ error: 'path is required' });

    const wdir = await getWorkspaceDir();
    const targetPath = path.resolve(wdir, relPath);
    if (!targetPath.startsWith(path.resolve(wdir))) {
      return reply.status(403).send({ error: 'Access denied: Path traversal attempt detected' });
    }

    try {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content, 'utf-8');
      return { ok: true };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  fastify.delete<{
    Querystring: { path: string };
  }>('/workspace/file', async (req, reply) => {
    const relPath = req.query.path;
    if (!relPath) return reply.status(400).send({ error: 'path is required' });

    const wdir = await getWorkspaceDir();
    const targetPath = path.resolve(wdir, relPath);
    if (!targetPath.startsWith(path.resolve(wdir))) {
      return reply.status(403).send({ error: 'Access denied: Path traversal attempt detected' });
    }

    try {
      const stats = await fs.stat(targetPath);
      if (stats.isDirectory()) {
        await fs.rmdir(targetPath);
      } else {
        await fs.unlink(targetPath);
      }
      return { ok: true };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });
}


