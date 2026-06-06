import { config } from '../config';
import { Logger } from '../utils/Logger';
import http from 'http';

export class InferenceProviders {
  public static getDefaultTaskName(type: string): string {
    const names: Record<string, string> = { 
      EVOLUTION: 'Architectural Evolution',
      
      // New Granular Types
      INTENT_CLASSIFICATION: 'Intent Classification',
      QUERY_EXPANSION: 'Query Expansion',
      CONCEPT_EXTRACTION: 'Concept Extraction',
      CONCEPT_ENRICHMENT: 'Concept Enrichment',
      IMPROVEMENT_DETECTION: 'Improvement Detection',
      PROACTIVE_INSIGHT: 'Proactive Insight',
      DEBATE_PARTICIPATION: 'Debate Participation',
      DEBATE_SUMMARY: 'Debate Summary',
      INSIGHT_DEDUP: 'Insight Deduplication',
      WIKI_SYNTHESIS: 'Wiki Synthesis',
      WIKI_TOPIC_MAP: 'Wiki Topic Map',
      CODE_EVOLUTION: 'Code Generation',
      EVOLUTION_VALIDATION: 'Evolution Validation',
      EMBEDDING_GENERATION: 'Vector Generation (Embeddings)',
      GENERAL_CHAT: 'General Chat',
      WEB_RESEARCH: 'Deep Web Research',
      AGENTIC_TASK: 'Autonomous Agent Task',
      DIRECTIVES_EXTRACTION: 'Directives Extraction'
    };
    return names[type] || `${type} Inference`;
  }

  public static resolveTarget(task: any, nodes: any[]): { provider: string, engine: string } {
    const taskRouting = task.options?.routing?.toUpperCase() || 'AUTO';
    let routing = taskRouting === 'AUTO' ? (config.routing?.preferredNode || 'AUTO').toUpperCase() : taskRouting;
    
    // Helper to check if a node is ONLINE (ignore locks for stable queuing)
    const isOnline = (nodeId: string): boolean => {
      const node = nodes.find(n => n.id.toUpperCase() === nodeId.toUpperCase() || n.name?.toUpperCase() === nodeId.toUpperCase());
      return !!(node && node.status === 'ONLINE');
    };

    Logger.debug('InferenceProviders', `Resolving target for task. Routing mode: ${routing}. Online nodes: ${nodes.map(n => n.id).join(', ')}`);

    // 1. Handle EXPLICIT routing (User requested a specific node)
    if (routing !== 'AUTO') {
      if (routing === 'GEMINI') return { provider: 'GEMINI', engine: 'GEMINI' };
      if (routing === 'OPENROUTER') return { provider: 'OPENROUTER', engine: 'OPENROUTER' };
      if (routing === 'FREELLMAPI') return { provider: 'FREELLMAPI', engine: 'OLLAMA' };
      if (routing === 'HERMES') return { provider: 'HERMES', engine: 'HERMES' };
      if (routing === 'OPENCLAW') return { provider: 'OPENCLAW', engine: 'OPENCLAW' };
      
      const explicit = nodes.find(n => n.id.toUpperCase() === routing || n.name?.toUpperCase() === routing);
      if (explicit && explicit.status === 'ONLINE') {
        const engine = explicit.type === 'mobile' ? 'MOBILE' : 'OLLAMA';
        Logger.debug('InferenceProviders', `Using explicit online node: ${explicit.id}`);
        return { provider: explicit.id, engine };
      } else {
        Logger.debug('InferenceProviders', `Explicit node ${routing} not found or offline. Falling back to AUTO list.`);
      }
    }

    // 2. Handle AUTO routing with task-specific priority list
    const taskType = task.type || 'STANDARD';
    const priorities = config.routing?.taskPriorities?.[taskType] || 
                       this.getFallbackPriority(taskType) ||
                       ['SERVER_LOCAL', 'GEMINI', 'OPENROUTER'];
    
    for (const target of priorities) {
      if (target === 'GEMINI' && config.gemini?.apiKey) {
        Logger.debug('InferenceProviders', `AUTO: Choosing GEMINI for ${taskType}`);
        return { provider: 'GEMINI', engine: 'GEMINI' };
      }
      if (target === 'OPENROUTER' && config.openrouter?.apiKey) {
        Logger.debug('InferenceProviders', `AUTO: Choosing OPENROUTER for ${taskType}`);
        return { provider: 'OPENROUTER', engine: 'OPENROUTER' };
      }
      if (target === 'FREELLMAPI' && config.freellmapi?.apiKey) {
        Logger.debug('InferenceProviders', `AUTO: Choosing FREELLMAPI for ${taskType}`);
        return { provider: 'FREELLMAPI', engine: 'OLLAMA' };
      }
      if (isOnline(target)) {
        const node = nodes.find(n => n.id.toUpperCase() === target);
        const engine = node?.type === 'mobile' ? 'MOBILE' : 'OLLAMA';
        Logger.debug('InferenceProviders', `AUTO: Choosing ${target} for ${taskType}`);
        return { provider: target, engine };
      }
    }

    // Ultimate fallback
    Logger.debug('InferenceProviders', `AUTO: Nothing online from priorities, falling back to SERVER_LOCAL default`);
    return { provider: 'SERVER_LOCAL', engine: 'OLLAMA' };
  }

  private static getFallbackPriority(type: string): string[] | null {
    const legacyMap: Record<string, string> = {
      INTENT_CLASSIFICATION: 'LIGHTWEIGHT',
      QUERY_EXPANSION: 'LIGHTWEIGHT',
      CONCEPT_EXTRACTION: 'LIGHTWEIGHT',
      CONCEPT_ENRICHMENT: 'LIGHTWEIGHT',
      IMPROVEMENT_DETECTION: 'LIGHTWEIGHT',
      PROACTIVE_INSIGHT: 'STANDARD',
      DEBATE_PARTICIPATION: 'STANDARD',
      INSIGHT_DEDUP: 'STANDARD',
      DEBATE_SUMMARY: 'STANDARD',
      GENERAL_CHAT: 'STANDARD',
      SCHEDULED_TASK: 'STANDARD',
      WIKI_SYNTHESIS: 'COMPLEX',
      WIKI_TOPIC_MAP: 'COMPLEX',
      CODE_EVOLUTION: 'EVOLUTION',
      EVOLUTION_VALIDATION: 'STANDARD',
      EMBEDDING_GENERATION: 'EMBEDDING',
      WEB_RESEARCH: 'RESEARCH',
      AGENTIC_TASK: 'AGENTIC',
      DIRECTIVES_EXTRACTION: 'STANDARD'
    };
    const legacyType = legacyMap[type];
    if (legacyType) return config.routing?.taskPriorities?.[legacyType] || null;
    return null;
  }

  public static getProviderDetails(target: string, engine: string, nodes: any[], config: any) {
    if (engine === 'GEMINI' || engine === 'OPENROUTER' || target === 'FREELLMAPI' || engine === 'HERMES' || engine === 'OPENCLAW') return { url: null, model: undefined };

    const node = nodes.find(n => n.id.toUpperCase() === target.toUpperCase() || n.name?.toUpperCase() === target.toUpperCase());
    if (!node) return { url: config.ollama.baseUrl, model: undefined };
    return {
      url: node.type === 'mobile' ? 'MOBILE_NODE' : node.ollama_url!,
      model: node.models?.[0]
    };
  }

  public static async callOllama(url: string, prompt: string, modelOverride?: string, externalSignal?: AbortSignal): Promise<string> {
    const currentTimeout = config.ollama?.timeoutMs || 86400000; // Default 24h
    const model = modelOverride || config.ollama.defaultModel;
    const baseUrl = url.replace(/\/$/, '');
    
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      // If an external signal is provided, abort this controller when it fires
      externalSignal?.addEventListener('abort', () => controller.abort());
      const timeout = setTimeout(() => {
        Logger.warn('InferenceProviders', `Ollama timeout triggered after ${currentTimeout}ms`);
        controller.abort();
        req.destroy(new Error(`Ollama timeout reached (${currentTimeout}ms)`));
      }, currentTimeout);

      const postData = JSON.stringify({
        model,
        prompt,
        stream: false,
        keep_alive: config.ollama?.keepAlive === "-1" ? -1 : (config.ollama?.keepAlive || -1),
        options: {
          num_thread: config.ollama?.numThread || 6,
          num_ctx: config.ollama?.numCtx || 4096
        }
      });

      const parsedUrl = new URL(baseUrl + '/api/generate');
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 80,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'X-API-Key': config.server.apiKey
        },
        signal: controller.signal
      };

      const req = http.request(options, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          clearTimeout(timeout);
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const data = JSON.parse(body);
              resolve(data.response);
            } catch (e) {
              reject(new Error('Invalid JSON response from Ollama'));
            }
          } else {
            Logger.error('InferenceProviders', `Ollama error HTTP ${res.statusCode}: ${body}`);
            reject(new Error(`Ollama HTTP ${res.statusCode}`));
          }
        });
      });

      req.on('error', async (err: any) => {
        clearTimeout(timeout);
        const cause = err.cause ? (err.cause.message || err.cause.code || JSON.stringify(err.cause)) : (err.code || 'N/A');
        const isAbort = err.name === 'AbortError' || err.message.toLowerCase().includes('aborted') || err.code === 'ECONNRESET';
        
        Logger.error('InferenceProviders', `Ollama request error [${isAbort ? 'ABORTED' : 'FAILED'}]: ${err.message} (Cause: ${cause})`);
        reject(err);
      });

      req.write(postData);
      req.end();
    });
  }

  public static async callGemini(prompt: string, externalSignal?: AbortSignal, modelOverride?: string, apiKey?: string): Promise<string> {
    const currentTimeout = config.gemini?.timeoutMs || 3600000; // Default 1h
    const controller = new AbortController();
    externalSignal?.addEventListener('abort', () => controller.abort());
    const timeout = setTimeout(() => controller.abort(), currentTimeout);

    const activeKey = apiKey || config.gemini.apiKey;
    try {
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + (modelOverride || config.gemini.model) + ':generateContent?key=' + activeKey,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
          signal: controller.signal as any
        }
      );

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        if (res.status === 429) {
          try {
            const errJson = JSON.parse(errText);
            const qFailure = errJson.error?.details?.find((d: any) => d['@type']?.includes('QuotaFailure'));
            const violation = qFailure?.violations?.[0];
            const quotaId = violation?.quotaId || '';

            const retryInfo = errJson.error?.details?.find((d: any) => d['@type']?.includes('RetryInfo'));
            if (retryInfo?.retryDelay) {
              const seconds = parseFloat(retryInfo.retryDelay.replace('s', ''));
              if (quotaId.includes('PerDay')) {
                throw new Error(`GEMINI_DAILY_QUOTA_EXCEEDED:${seconds}`);
              }
              throw new Error(`GEMINI_QUOTA_EXCEEDED:${seconds}`);
            }
          } catch (e: any) {
            if (e.message.startsWith('GEMINI_QUOTA_EXCEEDED') || e.message.startsWith('GEMINI_DAILY_QUOTA_EXCEEDED')) throw e;
          }
        }
        throw new Error('Gemini error: ' + errText);
      }

      const data = await res.json() as any;
      return data.candidates[0]?.content?.parts[0]?.text || '';
    } catch (err: any) {
      if (err.name === 'AbortError') throw new Error(`Gemini request timed out after ${currentTimeout}ms`);
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  public static async callOpenRouter(prompt: string, externalSignal?: AbortSignal, modelOverride?: string): Promise<string> {
    const currentTimeout = config.openrouter?.timeoutMs || 3600000; // Default 1h
    const controller = new AbortController();
    externalSignal?.addEventListener('abort', () => controller.abort());
    const timeout = setTimeout(() => controller.abort(), currentTimeout);

    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.openrouter.apiKey}`,
          'HTTP-Referer': 'https://aimindmesh.local',
          'X-Title': 'AIMindMesh'
        },
        body: JSON.stringify({
          model: modelOverride || config.openrouter.model,
          messages: [{ role: 'user', content: prompt }]
        }),
        signal: controller.signal as any
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error('OpenRouter error: ' + errText);
      }

      const data = await res.json() as any;
      return data.choices?.[0]?.message?.content || '';
    } catch (err: any) {
      if (err.name === 'AbortError') throw new Error(`OpenRouter request timed out after ${currentTimeout}ms`);
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  public static async callFreeLLMAPI(prompt: string, externalSignal?: AbortSignal, modelOverride?: string): Promise<string> {
    const currentTimeout = config.freellmapi?.timeoutMs || 120000;
    const controller = new AbortController();
    externalSignal?.addEventListener('abort', () => controller.abort());
    const timeout = setTimeout(() => controller.abort(), currentTimeout);

    const requestBody: any = {
      messages: [{ role: 'user', content: prompt }]
    };

    if (modelOverride && modelOverride !== 'auto') {
      requestBody.model = modelOverride;
    }

    try {
      const res = await fetch(`${config.freellmapi?.baseUrl || 'http://10.2.0.54:3001'}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.freellmapi?.apiKey}`
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal as any
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error('FreeLLMAPI error: ' + errText);
      }

      const data = await res.json() as any;
      return data.choices?.[0]?.message?.content || '';
    } catch (err: any) {
      if (err.name === 'AbortError') throw new Error(`FreeLLMAPI request timed out after ${currentTimeout}ms`);
      const cause = err.cause ? (err.cause.message || err.cause.code || JSON.stringify(err.cause)) : '';
      throw new Error(`FreeLLMAPI unreachable: ${err.message} ${cause}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  public static async getEmbeddings(url: string, text: string): Promise<number[]> {
    const baseUrl = url.replace(/\/$/, '');
    const apiurl = baseUrl + '/api/embeddings';
    try {
      const res = await fetch(apiurl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.ollama.embeddingModel || 'nomic-embed-text',
          prompt: text,
          options: {
             num_ctx: 2048
          }
        }),
      });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error('Ollama Embedding error (HTTP ' + res.status + '): ' + (errorText || res.statusText));
      }
      const data = await res.json() as any;
      return data.embedding;
    } catch (err: any) {
      let msg = err.message;
      if (err.cause?.code === 'ECONNREFUSED' || err.code === 'ECONNREFUSED') {
        msg = 'Ollama unreachable at ' + apiurl;
      }
      Logger.error('InferenceProviders', 'Embedding generation failed: ' + msg);
      throw new Error(msg);
    }
  }

  public static async fetchOpenRouterModels(): Promise<any[]> {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
          'HTTP-Referer': 'https://aimindmesh.local',
          'X-Title': 'AIMindMesh'
        }
      });
      if (!res.ok) throw new Error(`OpenRouter API error: ${res.statusText}`);
      const data = await res.json() as any;
      return data.data || [];
    } catch (err: any) {
      Logger.error('InferenceProviders', 'Failed to fetch OpenRouter models: ' + err.message);
      return [];
    }
  }
}
