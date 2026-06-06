import fs from 'fs';
import path from 'path';
import { Logger } from '../utils/Logger';

export interface ReleaseInfo {
  version: string;
  deb?: string;
  appimage?: string;
  apk?: string;
  timestamp: string;
  notes?: string;
}

export interface Versions {
  pc?: ReleaseInfo;
  android?: ReleaseInfo;
}

export class ReleaseService {
  private static readonly downloadsDir = path.join(__dirname, '../../data/downloads');
  private static readonly versionsPath = path.join(this.downloadsDir, 'versions.json');

  static async getVersions(): Promise<Versions> {
    try {
      if (!fs.existsSync(this.versionsPath)) {
        return { pc: undefined, android: undefined };
      }
      const content = await fs.promises.readFile(this.versionsPath, 'utf-8');
      return JSON.parse(content) as Versions;
    } catch (error: any) {
      Logger.error('ReleaseService', `Failed to read versions.json: ${error.message}`);
      return { pc: undefined, android: undefined };
    }
  }

  static async updatePCRelease(info: ReleaseInfo): Promise<void> {
    const versions = await this.getVersions();
    versions.pc = info;
    await this.saveVersions(versions);
  }

  static async updateAndroidRelease(info: ReleaseInfo): Promise<void> {
    const versions = await this.getVersions();
    versions.android = info;
    await this.saveVersions(versions);
  }

  private static async saveVersions(versions: Versions): Promise<void> {
    try {
      if (!fs.existsSync(this.downloadsDir)) {
        await fs.promises.mkdir(this.downloadsDir, { recursive: true });
      }
      await fs.promises.writeFile(this.versionsPath, JSON.stringify(versions, null, 2));
    } catch (error: any) {
      Logger.error('ReleaseService', `Failed to save versions.json: ${error.message}`);
      throw error;
    }
  }
}
