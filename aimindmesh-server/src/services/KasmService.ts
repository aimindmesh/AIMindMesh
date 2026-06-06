import axios from 'axios';
import { config } from '../config';
import { Logger } from '../utils/Logger';

export interface KasmSession {
  kasm_id: string;
  kasm_url: string;
  share_id?: string;
}

export class KasmService {
  private static get client() {
    if (!config.kasm?.enabled) {
      throw new Error('Kasm integration is disabled in config.');
    }
    return axios.create({
      baseURL: config.kasm.baseUrl,
      headers: {
        'Content-Type': 'application/json',
      },
      httpsAgent: new (require('https').Agent)({
        rejectUnauthorized: false,
      }),
    } as any);
  }

  private static get auth() {
    return {
      api_key: config.kasm?.apiKey,
      api_key_secret: config.kasm?.apiKeySecret,
    };
  }

  static async requestSession(imageName?: string): Promise<KasmSession> {
    const payload = {
      ...this.auth,
      image_id: imageName || config.kasm?.defaultImage,
      user_id: config.kasm?.userId,
    };

    Logger.info('KasmService', `Requesting session for image: ${payload.image_id}`);
    try {
      const res = await this.client.post('/api/public/request_kasm', payload);
      return res.data as any;
    } catch (error: any) {
      Logger.error('KasmService', `Failed to request session: ${error.message}`);
      throw error;
    }
  }

  static async executeCommand(kasmId: string, cmd: string): Promise<any> {
    const payload = {
      ...this.auth,
      kasm_id: kasmId,
      user_id: config.kasm?.userId,
      exec_config: {
        cmd: cmd,
      },
    };

    Logger.info('KasmService', `Executing command in session ${kasmId}: ${cmd}`);
    try {
      const res = await this.client.post('/api/public/exec_command_kasm', payload);
      return res.data;
    } catch (error: any) {
      Logger.error('KasmService', `Failed to execute command: ${error.message}`);
      throw error;
    }
  }

  static async getScreenshot(kasmId: string): Promise<string> {
    const payload = {
      ...this.auth,
      kasm_id: kasmId,
    };

    Logger.info('KasmService', `Capturing screenshot for session ${kasmId}`);
    try {
      const res = await this.client.post('/api/public/get_kasm_screenshot', payload);
      // Returns base64 or buffer depending on Kasm version
      return (res.data as any).screenshot; 
    } catch (error: any) {
      Logger.error('KasmService', `Failed to get screenshot: ${error.message}`);
      throw error;
    }
  }

  static async destroySession(kasmId: string): Promise<void> {
    const payload = {
      ...this.auth,
      kasm_id: kasmId,
      user_id: config.kasm?.userId,
    };

    Logger.info('KasmService', `Destroying session ${kasmId}`);
    try {
      await this.client.post('/api/public/destroy_kasm', payload);
    } catch (error: any) {
      Logger.error('KasmService', `Failed to destroy session: ${error.message}`);
      throw error;
    }
  }

  static async listSessions(): Promise<any[]> {
    const payload = {
      ...this.auth,
    };

    try {
      const res = await this.client.post('/api/public/get_kasms', payload);
      const sessions = (res.data as any).kasms || [];
      
      // Construct the URL for each session since Kasm API doesn't return it in list
      return sessions.map((s: any) => ({
        ...s,
        kasm_url: `${config.kasm?.baseUrl}/#/session/${s.kasm_id}`
      }));
    } catch (error: any) {
      Logger.error('KasmService', `Failed to list sessions: ${error.message}`);
      return [];
    }
  }

  static async getImages(): Promise<any[]> {
    const payload = {
      ...this.auth,
    };

    try {
      const res = await this.client.post('/api/public/get_images', payload);
      return (res.data as any).images || [];
    } catch (error: any) {
      Logger.error('KasmService', `Failed to get images: ${error.message}`);
      return [];
    }
  }
}
