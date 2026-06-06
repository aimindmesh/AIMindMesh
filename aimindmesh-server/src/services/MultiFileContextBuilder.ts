import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { config } from '../config';
import { Logger } from '../utils/Logger';
import { GiteaEvolutionService } from './GiteaEvolutionService';

export interface FileContext {
  path: string;
  content: string;
  relationship: 'target' | 'imports' | 'imported_by' | 'shared_contract' | 'db_schema' | 'config_types';
  tier: 1 | 2 | 3 | 4 | 5 | 6;
  truncated: boolean;
}

export interface MultiFileContext {
  target: FileContext;
  relatedFiles: FileContext[];
  totalTokenEstimate: number;
  warnings: string[];
}

export class MultiFileContextBuilder {
  private readonly repoPath: string;
  private readonly MAX_TOKENS = 80000; // budget total for the prompt

  constructor(
    private readonly giteaService?: GiteaEvolutionService,
    repoPath?: string
  ) {
    this.repoPath = repoPath ?? config.autoEvolution?.repoLocalPath ?? '/app';
  }

  async build(
    targetComponent: string,
    repository: string = 'AIMindMesh',
    estimatedImpact: 'low' | 'medium' | 'high' = 'medium',
    affectedComponents: string[] = []
  ): Promise<MultiFileContext> {
    const warnings: string[] = [];
    const localTargetComp = targetComponent.startsWith('aimindmesh-server/')
      ? targetComponent.substring('aimindmesh-server/'.length)
      : targetComponent;
    const targetPath = path.join(this.repoPath, localTargetComp);

    Logger.info('MultiFileContextBuilder', `Building context for ${targetComponent} (Impact: ${estimatedImpact})`);

    // ── Tier 1: Target file ───────────────────────────────────────────────
    const targetContent = await this.readFile(targetPath, targetComponent, repository);
    const target: FileContext = {
      path: targetComponent,
      content: targetContent,
      relationship: 'target',
      tier: 1,
      truncated: false,
    };

    const relatedFiles: FileContext[] = [];
    let usedTokens = this.estimateTokens(targetContent);

    // ── Tier 2: Direct imports ────────────────────────────────────────────
    const directImports = this.extractImports(targetContent);
    // Prioritize affectedComponents that are also direct imports
    const prioritizedImports = [
      ...affectedComponents.filter(ac => directImports.some(di => di.includes(path.basename(ac, '.ts')))),
      ...directImports.filter(di => !affectedComponents.some(ac => di.includes(path.basename(ac, '.ts'))))
    ];

    for (const imp of prioritizedImports.slice(0, 4)) {
      const absPath = this.resolveImportPath(targetPath, imp);
      if (!absPath) continue;
      const raw = await this.readFileLocal(absPath);
      if (!raw) continue;
      const capped = this.capLines(raw, 300);
      
      const tokens = this.estimateTokens(capped);
      if (usedTokens + tokens > this.MAX_TOKENS) {
        warnings.push(`Tier 2 budget exceeded at ${imp}`);
        break;
      }
      
      usedTokens += tokens;
      relatedFiles.push({
        path: `aimindmesh-server/${path.relative(this.repoPath, absPath)}`,
        content: capped,
        relationship: 'imports',
        tier: 2,
        truncated: capped.length < raw.length,
      });
    }

    // ── Tier 3: Reverse dependencies (who uses targetFile) ─────────────────
    if (estimatedImpact !== 'low') {
      const reverseDeps = this.findReverseDependencies(targetComponent);
      // Also include affectedComponents that were NOT in Tier 2
      const extraAffected = affectedComponents
        .filter(ac => ac !== targetComponent && !relatedFiles.some(rf => rf.path.includes(path.basename(ac, '.ts'))))
        .map(ac => {
          const localAc = ac.startsWith('aimindmesh-server/') ? ac.substring('aimindmesh-server/'.length) : ac;
          return path.join(this.repoPath, localAc);
        });

      const allReverse = [...reverseDeps, ...extraAffected.map(ap => path.relative(this.repoPath, ap))];

      for (const depPath of [...new Set(allReverse)].slice(0, 3)) {
        const raw = await this.readFileLocal(path.join(this.repoPath, depPath));
        if (!raw) continue;
        
        // Extract only lines referring to the target
        const relevant = this.extractRelevantLines(raw, path.basename(targetComponent, path.extname(targetComponent)));
        const capped = this.capLines(relevant, 80);
        
        const tokens = this.estimateTokens(capped);
        if (usedTokens + tokens > this.MAX_TOKENS) {
          warnings.push(`Tier 3 budget exceeded at ${depPath}`);
          break;
        }
        
        usedTokens += tokens;
        relatedFiles.push({
          path: `aimindmesh-server/${depPath}`,
          content: capped,
          relationship: 'imported_by',
          tier: 3,
          truncated: true,
        });
      }
    }

    // ── Tier 4: Shared contracts ───────────────────────────────────────────
    const contractFiles = this.findSharedContracts(targetContent, targetPath);
    for (const contractPath of contractFiles.slice(0, 2)) {
      const raw = await this.readFileLocal(contractPath);
      if (!raw) continue;
      
      if (usedTokens + this.estimateTokens(raw) > this.MAX_TOKENS) {
        warnings.push(`Tier 4 budget exceeded at ${contractPath}`);
        break;
      }
      
      usedTokens += this.estimateTokens(raw);
      relatedFiles.push({
        path: `aimindmesh-server/${path.relative(this.repoPath, contractPath)}`,
        content: raw,
        relationship: 'shared_contract',
        tier: 4,
        truncated: false,
      });
    }

    // ── Tier 5: DB schema ─────────────────────────────────────────────────
    if (targetContent.includes('db.prepare')) {
      const tables = this.extractUsedTables(targetContent);
      if (tables.length > 0) {
        const schema = this.extractSchemaForTables(tables);
        if (schema) {
          if (usedTokens + this.estimateTokens(schema) <= this.MAX_TOKENS) {
            usedTokens += this.estimateTokens(schema);
            relatedFiles.push({
              path: 'src/db/schema.sql [extracted]',
              content: schema,
              relationship: 'db_schema',
              tier: 5,
              truncated: false,
            });
          }
        }
      }
    }

    // ── Tier 6: Config types ───────────────────────────────────────────────
    const usedConfigKeys = this.extractConfigAccess(targetContent);
    if (usedConfigKeys.length > 0) {
      const configSnippet = this.extractConfigTypes(usedConfigKeys);
      if (configSnippet) {
        if (usedTokens + this.estimateTokens(configSnippet) <= this.MAX_TOKENS) {
          usedTokens += this.estimateTokens(configSnippet);
          relatedFiles.push({
            path: 'src/config.ts [extracted]',
            content: configSnippet,
            relationship: 'config_types',
            tier: 6,
            truncated: true,
          });
        }
      }
    }

    return { target, relatedFiles, totalTokenEstimate: usedTokens, warnings };
  }

  private findReverseDependencies(targetComponent: string): string[] {
    try {
      const basename = path.basename(targetComponent, path.extname(targetComponent));
      // Using grep -r to find files importing the target
      // We look for "from" followed by something and then the basename
      const cmd = `grep -rl "from.*${basename}" "${this.repoPath}" --include="*.ts" 2>/dev/null | head -10`;
      const result = execSync(cmd, { encoding: 'utf-8', timeout: 5000 });
      return result
        .split('\n')
        .filter(Boolean)
        .map(p => path.relative(this.repoPath, p))
        .filter(p => {
          const localTarget = targetComponent.startsWith('aimindmesh-server/')
            ? targetComponent.substring('aimindmesh-server/'.length)
            : targetComponent;
          return p !== localTarget && !p.includes('node_modules');
        });
    } catch (e) {
      Logger.warn('MultiFileContextBuilder', `grep reverse-dep failed: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }

  private findSharedContracts(content: string, targetPath: string): string[] {
    const contracts: string[] = [];
    const typeImportRegex = /from\s+['"](\.\/[^'"]*(?:types?|interfaces?|models?|schema)[^'"]*)['"]/gi;
    let m: RegExpExecArray | null;
    while ((m = typeImportRegex.exec(content)) !== null) {
      const resolved = this.resolveImportPath(targetPath, m[1]);
      if (resolved && fs.existsSync(resolved)) contracts.push(resolved);
    }
    
    const commonTypePaths = [
      path.join(this.repoPath, 'src/types/index.ts'),
      path.join(this.repoPath, 'src/types.ts'),
    ];
    for (const p of commonTypePaths) {
      if (fs.existsSync(p) && !contracts.includes(p)) contracts.push(p);
    }
    return contracts;
  }

  private extractUsedTables(content: string): string[] {
    const tableRegex = /(?:FROM|INTO|UPDATE|TABLE(?:\s+IF\s+NOT\s+EXISTS)?)\s+([a-z_0-9]+)/gi;
    const tables = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = tableRegex.exec(content)) !== null) {
      tables.add(m[1].toLowerCase());
    }
    return Array.from(tables);
  }

  private extractSchemaForTables(tables: string[]): string | null {
    const candidates = [
      path.join(this.repoPath, 'src/db/sqlite.ts'),
      path.join(this.repoPath, 'src/db/schema.sql'),
    ];
    for (const dbFile of candidates) {
      if (!fs.existsSync(dbFile)) continue;
      const raw = fs.readFileSync(dbFile, 'utf-8');
      const lines = raw.split('\n');
      const relevant: string[] = [];
      let inCreateTable = false;
      for (const line of lines) {
        const lowerLine = line.toLowerCase();
        const tableMatch = tables.find(t => (lowerLine.includes(`create table`) || lowerLine.includes(`table if not exists`)) && lowerLine.includes(t));
        if (tableMatch) inCreateTable = true;
        if (inCreateTable) {
          relevant.push(line);
          if (line.includes(');') || line.includes('`')) { // Handle both SQL and TS template strings
             if (line.includes(');')) inCreateTable = false;
          }
        }
      }
      if (relevant.length > 0) return relevant.join('\n');
    }
    return null;
  }

  private extractConfigAccess(content: string): string[] {
    const configRegex = /config\.([a-zA-Z0-9]+)(?:\.([a-zA-Z0-9]+))?/g;
    const keys = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = configRegex.exec(content)) !== null) {
      keys.add(m[1] + (m[2] ? '.' + m[2] : ''));
    }
    return Array.from(keys);
  }

  private extractConfigTypes(usedKeys: string[]): string | null {
    const configPath = [
      path.join(this.repoPath, 'src/config.ts'),
      path.join(this.repoPath, 'src/config/index.ts'),
      path.join(this.repoPath, 'src/config/config.ts'),
    ].find(p => fs.existsSync(p));
    
    if (!configPath) return null;

    const raw = fs.readFileSync(configPath, 'utf-8');
    const lines = raw.split('\n');
    const topLevelKeys = [...new Set(usedKeys.map(k => k.split('.')[0]))];
    const relevant: string[] = ['// Config types (keys used by target file)'];

    for (const key of topLevelKeys) {
      let depth = 0;
      let capturing = false;
      for (const line of lines) {
        if (!capturing && (line.includes(`${key}?:`) || line.includes(`${key}:`))) {
          capturing = true;
        }
        if (capturing) {
          relevant.push(line);
          depth += (line.match(/{/g) || []).length;
          depth -= (line.match(/}/g) || []).length;
          if (depth <= 0 && relevant.length > 1) { 
            capturing = false; 
            relevant.push('');
            break; 
          }
        }
      }
    }
    return relevant.length > 1 ? relevant.join('\n') : null;
  }

  private extractRelevantLines(content: string, targetBasename: string): string {
    const lines = content.split('\n');
    const relevant: string[] = [];
    const seenLines = new Set<number>();

    for (let i = 0; i < lines.length; i++) {
      if (
        lines[i].includes(targetBasename) ||
        lines[i].includes('class ') ||
        lines[i].includes('export ') ||
        lines[i].includes('async ') ||
        lines[i].includes('public ')
      ) {
        const start = Math.max(0, i - 1);
        const end = Math.min(lines.length - 1, i + 2);
        for (let j = start; j <= end; j++) {
          if (!seenLines.has(j)) {
            relevant.push(lines[j]);
            seenLines.add(j);
          }
        }
        relevant.push('// ...');
      }
    }
    return relevant.join('\n');
  }

  private extractImports(content: string): string[] {
    const importRegex = /from\s+['"](\.[^'"]+)['"]/g;
    const matches: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = importRegex.exec(content)) !== null) {
      matches.push(m[1]);
    }
    return [...new Set(matches)];
  }

  private resolveImportPath(currentFilePath: string, importPath: string): string | null {
    const dir = path.dirname(currentFilePath);
    const extensions = ['.ts', '.js', '.tsx', '.jsx'];
    
    for (const ext of extensions) {
      const fullPath = path.resolve(dir, importPath + ext);
      if (fs.existsSync(fullPath)) return fullPath;
      
      const indexPath = path.resolve(dir, importPath, 'index' + ext);
      if (fs.existsSync(indexPath)) return indexPath;
    }
    
    return null;
  }

  private capLines(content: string, maxLines: number): string {
    const lines = content.split('\n');
    if (lines.length <= maxLines) return content;
    return lines.slice(0, maxLines).join('\n') + '\n// ... [truncated]';
  }

  private estimateTokens(content: string): number {
    return Math.ceil(content.length / 4);
  }

  private async readFile(localPath: string, remotePath: string, repository: string): Promise<string> {
    if (fs.existsSync(localPath)) return fs.readFileSync(localPath, 'utf-8');
    if (this.giteaService) return this.giteaService.getFileContent(remotePath, repository);
    throw new Error(`Target file not found: ${localPath}`);
  }

  private async readFileLocal(absPath: string): Promise<string | null> {
    try {
      return fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf-8') : null;
    } catch {
      return null;
    }
  }
}
