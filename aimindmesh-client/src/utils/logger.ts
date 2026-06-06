export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

class ClientLogger {
  private level: LogLevel = (localStorage.getItem('ag_log_level') as LogLevel) || 'INFO';

  private priorities: Record<LogLevel, number> = {
    'DEBUG': 0,
    'INFO': 1,
    'WARN': 2,
    'ERROR': 3
  };

  private pulseBuffer: any[] = [];
  private maxBufferSize = 200;

  /**
   * Updates the runtime logging level and persists it to local storage.
   * This should be called when the application configuration is loaded or changed.
   */
  setLevel(level: LogLevel) {
    if (this.level === level) return;
    
    this.level = level;
    localStorage.setItem('ag_log_level', level);
    console.log(`%c[Logger] Log level set to ${level}`, 'color: #3b82f6; font-weight: bold; background: rgba(59, 130, 246, 0.1); padding: 2px 6px; border-radius: 4px;');
    this.addPulse('INFO', 'Logger', `Log level synchronized to ${level}`);
  }

  getLevel(): LogLevel {
    return this.level;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.priorities[level] >= this.priorities[this.level];
  }

  private addPulse(level: LogLevel, module: string, message: string) {
    const pulse = {
      id: `pc-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      timestamp: Date.now(),
      level,
      module: `CLIENT:${module}`,
      message
    };
    this.pulseBuffer.unshift(pulse);
    if (this.pulseBuffer.length > this.maxBufferSize) this.pulseBuffer.pop();
  }

  getPulses() {
    return this.pulseBuffer;
  }

  clearPulses() {
    this.pulseBuffer = [];
  }

  debug(module: string, message: string, ...args: any[]) {
    if (this.shouldLog('DEBUG')) {
      this.addPulse('DEBUG', module, message);
      console.debug(`%c[DEBUG] %c[${module}] %c${message}`, 'color: #6366f1; font-weight: bold;', 'color: #94a3b8; font-weight: bold;', 'color: inherit;', ...args);
    }
  }

  info(module: string, message: string, ...args: any[]) {
    if (this.shouldLog('INFO')) {
      this.addPulse('INFO', module, message);
      console.log(`%c[INFO] %c[${module}] %c${message}`, 'color: #10b981; font-weight: bold;', 'color: #94a3b8; font-weight: bold;', 'color: inherit;', ...args);
    }
  }

  warn(module: string, message: string, ...args: any[]) {
    if (this.shouldLog('WARN')) {
      this.addPulse('WARN', module, message);
      console.warn(`%c[WARN] %c[${module}] %c${message}`, 'color: #f59e0b; font-weight: bold;', 'color: #94a3b8; font-weight: bold;', 'color: inherit;', ...args);
    }
  }

  error(module: string, message: string, ...args: any[]) {
    if (this.shouldLog('ERROR')) {
      this.addPulse('ERROR', module, message);
      console.error(`%c[ERROR] %c[${module}] %c${message}`, 'color: #ef4444; font-weight: bold;', 'color: #94a3b8; font-weight: bold;', 'color: inherit;', ...args);
    }
  }
}

export const Logger = new ClientLogger();
