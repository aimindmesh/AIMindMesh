import { FileSystemAdapter as Filesystem, Directory, Encoding } from '../utils/fileSystemAdapter';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  data?: any[];
}

type LogListener = (logs: LogEntry[]) => void;

class LoggerService {
  private logs: LogEntry[] = [];
  private listeners: Set<LogListener> = new Set();
  private isEnabled: boolean = false;
  private readonly MAX_LOGS = 200;

  constructor() {
    try {
      // Check if localStorage is available before attempting to access it.
      if (typeof window !== 'undefined' && window.localStorage) {
        const storedState = window.localStorage.getItem('logging-enabled');
        this.isEnabled = storedState ? JSON.parse(storedState) : false;
      } else {
        this.isEnabled = false;
      }
    } catch (e) {
      console.error("Failed to read logging state from localStorage", e);
      this.isEnabled = false;
    }
  }

  public enable() {
    if (!this.isEnabled) {
      this.isEnabled = true;
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('logging-enabled', 'true');
        }
      } catch (e) {
        console.error("Failed to save logging state to localStorage", e);
      }
      this.log('info', 'Logging enabled.');
    }
  }

  public disable() {
    if (this.isEnabled) {
      this.log('info', 'Logging disabled.');
      this.isEnabled = false;
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('logging-enabled', 'false');
        }
      } catch (e) {
        console.error("Failed to save logging state to localStorage", e);
      }
    }
  }

  public getIsEnabled(): boolean {
    return this.isEnabled;
  }

  public log(level: LogLevel, message: string, ...data: any[]) {
    // Always log to console for real-time debugging during this phase
    console[level](`[AI Mind Mesh] ${message}`, ...data);

    if (!this.isEnabled) {
      return;
    }

    this.addLogEntry(level, message, ...data);
  }

  /**
   * Log only to internal app logs, avoiding Logcat/Console
   */
  public logToAppOnly(level: LogLevel, message: string, ...data: any[]) {
    if (!this.isEnabled) {
      return;
    }
    // Skip console.log
    this.addLogEntry(level, message, ...data);
  }

  private addLogEntry(level: LogLevel, message: string, ...data: any[]) {
    const newEntry: LogEntry = {
      timestamp: new Date(),
      level,
      message,
      data: data.length > 0 ? data.map(d => this.sanitizeData(d)) : undefined,
    };

    this.logs.push(newEntry);

    if (this.logs.length > this.MAX_LOGS) {
      this.logs.shift(); // Keep the log size manageable
    }

    this.notifyListeners();
  }

  public getLogs(): LogEntry[] {
    return [...this.logs];
  }

  public clear() {
    this.logs = [];
    this.log('info', 'Logs cleared.');
  }

  public subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    // Immediately notify with current logs
    listener(this.getLogs());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners() {
    const currentLogs = this.getLogs();
    for (const listener of this.listeners) {
      listener(currentLogs);
    }
  }

  private sanitizeData(data: any): any {
    if (data instanceof Error) {
      return { name: data.name, message: data.message, stack: data.stack };
    }
    // Avoid circular structures in JSON.stringify
    try {
      // A simple way to handle potential circular refs
      JSON.stringify(data);
      return data;
    } catch (e) {
      return '[Unserializable object]';
    }
  }

  /**
   * Export logs to a file in Documents directory
   * Returns the file path on success
   */
  public async exportLogs(): Promise<string> {
    const logs = this.getLogs();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `ai-mind-mesh-logs-${timestamp}.txt`;

    const content = logs.map(entry => {
      const time = entry.timestamp.toISOString();
      const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : '';
      return `[${time}] [${entry.level.toUpperCase()}] ${entry.message}${dataStr}`;
    }).join('\n');

    try {
      // Ensure logs directory exists
      try {
        await Filesystem.mkdir({
          path: 'logs',
          directory: Directory.Documents,
          recursive: true
        });
      } catch (e) {
        // Directory may already exist
      }

      await Filesystem.writeFile({
        path: `logs/${filename}`,
        data: content,
        directory: Directory.Documents,
        encoding: Encoding.UTF8
      });

      const path = `Documents/logs/${filename}`;
      console.log(`[AI Mind Mesh] Logs exported to ${path}`);
      return path;
    } catch (error) {
      console.error('[AI Mind Mesh] Failed to export logs', error);
      throw error;
    }
  }
}

export const logger = new LoggerService();