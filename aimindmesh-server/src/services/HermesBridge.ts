import axios from 'axios';
import { Logger } from '../utils/Logger';
import { config } from '../config';

const getHermesBase = () => process.env.HERMES_URL ?? config.hermes?.gatewayUrl ?? '';
const getHermesKey = () => process.env.HERMES_API_KEY || config.hermes?.apiServerKey || '';

function getClient(timeoutMs?: number) {
  const baseURL = getHermesBase().replace(/\/$/, '') + '/v1';
  const apiKey = getHermesKey();
  
  return axios.create({
    baseURL,
    timeout: timeoutMs ?? config.hermes?.taskTimeoutMs ?? 300000,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': apiKey ? `Bearer ${apiKey}` : undefined,
    },
  });
}

export class HermesBridge {
  public static async isReachable(): Promise<boolean> {
    const url = getHermesBase();
    try {
      const client = getClient(5000); // 5s timeout for health check
      const res = await client.get('/models');
      return res.status === 200;
    } catch (err: any) {
      Logger.error('HermesBridge', `Hermes Agent unreachable at ${url}: ${err.message}`);
      return false;
    }
  }

  public static async runAgentTask(prompt: string, sessionKey = 'system'): Promise<{ reply: string; durationMs: number }> {
    const startTime = Date.now();
    const url = getHermesBase();
    Logger.info('HermesBridge', `Starting Hermes agent task for session ${sessionKey}...`);

    try {
      const client = getClient();
      const response = await client.post('/chat/completions', {
        model: 'hermes',
        messages: [{ role: 'user', content: prompt }],
        user: sessionKey,
        stream: false
      });

      const reply = (response.data as any).choices?.[0]?.message?.content || '';
      return {
        reply,
        durationMs: Date.now() - startTime,
      };
    } catch (err: any) {
      const cause = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      Logger.error('HermesBridge', `Task execution failed at ${url}: ${cause}`);
      throw new Error(`Hermes API error: ${cause}`);
    }
  }

  public static async *streamAgentTask(prompt: string, sessionKey = 'system'): AsyncGenerator<string> {
    Logger.info('HermesBridge', `Starting streaming Hermes task for session ${sessionKey}...`);
    
    try {
      const client = getClient();
      const response = await client.post('/chat/completions', {
        model: 'hermes',
        messages: [{ role: 'user', content: prompt }],
        user: sessionKey,
        stream: true
      }, {
        responseType: 'stream'
      });

      const stream = response.data as any;
      let buffer = '';

      for await (const chunk of stream) {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        // Keep the last partial line in buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          const cleaned = line.trim();
          if (cleaned.startsWith('data: ')) {
            const dataStr = cleaned.slice(6);
            if (dataStr === '[DONE]') {
              return;
            }
            try {
              const parsed = JSON.parse(dataStr);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                yield delta;
              }
            } catch (e) {
              // Ignore parse errors on partial chunks
            }
          }
        }
      }
    } catch (err: any) {
      Logger.error('HermesBridge', `Streaming failed: ${err.message}`);
      throw err;
    }
  }
}
