import crypto from 'crypto';
import db from '../db/sqlite';
import { config } from '../config';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export class Logger {
  private static readonly PRIORITIES: Record<LogLevel, number> = {
    'DEBUG': 0,
    'INFO': 1,
    'WARN': 2,
    'ERROR': 3
  };
  
  private static rawLogs: string[] = [];
  private static readonly MAX_RAW_LOGS = 1000;
  private static originalStdoutWrite = process.stdout.write.bind(process.stdout);
  private static originalStderrWrite = process.stderr.write.bind(process.stderr);

  static {
    // Intercept stderr for CRASHES and critical errors from external libs
    process.stderr.write = (chunk: any, encoding?: any, callback?: any) => {
      this.addToRawBuffer(`[STDERR] ${chunk.toString()}`);
      return this.originalStderrWrite(chunk, encoding, callback);
    };
    
    // We stop intercepting stdout globally to avoid double logging and 
    // to strictly respect the log level settings for our own logs.
  }

  private static addToRawBuffer(text: string) {
    this.rawLogs.push(text);
    if (this.rawLogs.length > this.MAX_RAW_LOGS) {
      this.rawLogs.shift();
    }
  }

  static getRawLogs(limit: number = 200) {
    return this.rawLogs.slice(-limit).join('');
  }

  private static writeLog(level: LogLevel, moduleName: string, message: string, metadata?: any) {
    const currentLevel = config.logging?.level || 'INFO';
    
    if (this.PRIORITIES[level] < (this.PRIORITIES[currentLevel as LogLevel] ?? 1)) {
      return;
    }

    const timestamp = Date.now();
    const id = crypto.randomUUID();
    const metaStr = metadata ? JSON.stringify(metadata) : null;
    
    // Write to console with color coding
    const colorCode = level === 'ERROR' ? '\x1b[31m' : level === 'WARN' ? '\x1b[33m' : level === 'DEBUG' ? '\x1b[36m' : '\x1b[32m';
    const logLine = `${colorCode}[${level}]\x1b[0m [${moduleName}] ${message}${metadata ? ' ' + JSON.stringify(metadata) : ''}`;
    
    // Manual write to original stdout to avoid being intercepted or skipped
    this.originalStdoutWrite(logLine + '\n');
    this.addToRawBuffer(logLine + '\n');

    // Skip persistence for DEBUG unless specified (to avoid DB bloat)
    if (level === 'DEBUG') return;

    // Write to SQLite
    try {
      const stmt = db.prepare(`
        INSERT INTO system_logs (id, level, module, message, metadata, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(id, level, moduleName, message, metaStr, timestamp);
    } catch (e) {
      console.error(`\x1b[31m[Logger Error]\x1b[0m Failed to write log to DB:`, e);
    }
  }

  static info(moduleName: string, message: string, metadata?: any) {
    this.writeLog('INFO', moduleName, message, metadata);
  }

  static warn(moduleName: string, message: string, metadata?: any) {
    this.writeLog('WARN', moduleName, message, metadata);
  }

  static error(moduleName: string, message: string, metadata?: any) {
    this.writeLog('ERROR', moduleName, message, metadata);
  }

  static debug(moduleName: string, message: string, metadata?: any) {
    this.writeLog('DEBUG', moduleName, message, metadata);
  }

  static getLogs(limit: number = 50, level?: LogLevel) {
    try {
      let query = `SELECT * FROM system_logs`;
      const params: any[] = [];
      if (level) {
        query += ` WHERE level = ?`;
        params.push(level);
      }
      query += ` ORDER BY timestamp DESC LIMIT ?`;
      params.push(limit);
      
      return db.prepare(query).all(...params);
    } catch (e) {
      console.error('Failed to fetch logs from DB', e);
      return [];
    }
  }
}
