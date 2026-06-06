/**
 * WikiManager.ts
 * Low-level filesystem service for the Neural Wiki.
 * Handles page persistence, index maintenance, and optional git commits.
 * Never calls LLM — purely I/O.
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { Logger } from '../utils/Logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WikiPage {
  slug: string;        // URL-safe identifier, e.g. "deep-learning"
  folder?: string;     // Optional subdirectory, e.g. "topics", "concepts"
  title: string;
  body: string;        // Markdown body (no frontmatter)
  neo4jId?: string;    // Optional back-link to Neo4j concept/insight node
  tags: string[];
  sources?: { type: string; id: string }[]; // Multimodal source tracking
  updatedAt: string;   // ISO 8601 timestamp
}

export interface WikiPageSummary {
  slug: string;
  folder?: string;
  title: string;
  tags: string[];
  updatedAt: string;
  neo4jId?: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function toFrontmatter(page: WikiPage): string {
  const tags = page.tags.length > 0 ? `[${page.tags.map(t => `"${t}"`).join(', ')}]` : '[]';
  const sourcesStr = page.sources && page.sources.length > 0 ? JSON.stringify(page.sources) : '[]';
  return [
    '---',
    `title: "${page.title.replace(/"/g, '\\"')}"`,
    page.neo4jId ? `neo4jId: "${page.neo4jId}"` : null,
    `tags: ${tags}`,
    `sources: ${sourcesStr}`,
    `updatedAt: "${page.updatedAt}"`,
    '---',
    '',
  ].filter(l => l !== null).join('\n');
}

function parseFrontmatter(raw: string): { meta: Record<string, any>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta: Record<string, any> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim().replace(/^"|"$/g, '');
    if (key === 'tags' || key === 'sources') {
      // Parse inline JSON array like ["a", "b"]
      try { meta[key] = JSON.parse(val.replace(/'/g, '"')); } catch { meta[key] = []; }
    } else {
      meta[key] = val;
    }
  }
  return { meta, body: match[2] };
}

async function getFilesRecursive(dir: string): Promise<string[]> {
  const dirents = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(dirents.map((dirent) => {
    const res = path.resolve(dir, dirent.name);
    return dirent.isDirectory() ? getFilesRecursive(res) : [res];
  }));
  return Array.prototype.concat(...files);
}

// ─── WikiManager ──────────────────────────────────────────────────────────────

export class WikiManager {
  private static storageDir = '';
  private static gitEnabled = false;

  /**
   * Initialize storage directory. Called once at server boot.
   */
  public static async init(storagePath: string, gitEnabled = false): Promise<void> {
    this.storageDir = path.resolve(storagePath);
    this.gitEnabled = gitEnabled;

    await fs.mkdir(this.storageDir, { recursive: true });
    Logger.info('WikiManager', `Storage initialized at ${this.storageDir}`);

    // Bootstrap index and log if absent
    const indexPath = path.join(this.storageDir, 'index.md');
    const logPath = path.join(this.storageDir, 'log.md');

    if (!fsSync.existsSync(indexPath)) {
      await fs.writeFile(indexPath, '# Neural Wiki — Index\n\n_No pages yet._\n', 'utf-8');
    }
    if (!fsSync.existsSync(logPath)) {
      await fs.writeFile(logPath, '# Neural Wiki — Log\n\n', 'utf-8');
    }
  }

  /**
   * Atomically write a wiki page to disk.
   */
  public static async savePage(page: WikiPage): Promise<void> {
    if (!this.storageDir) throw new Error('WikiManager not initialized');

    // Check for existing files with the same slug to prevent duplicates across folders
    const allFiles = await getFilesRecursive(this.storageDir);
    const existingFiles = allFiles.filter(f => path.basename(f, '.md') === page.slug && !f.endsWith('index.md') && !f.endsWith('log.md'));

    const folderPath = page.folder ? path.join(this.storageDir, page.folder) : this.storageDir;
    await fs.mkdir(folderPath, { recursive: true });
    
    const filePath = path.join(folderPath, `${page.slug}.md`);
    
    // Delete older copies if they exist in a different path
    for (const file of existingFiles) {
      if (file !== filePath) {
        await fs.unlink(file).catch(() => null);
        Logger.debug('WikiManager', `Removed older duplicate of page: ${file}`);
      }
    }

    const tmpPath = `${filePath}.tmp`;
    const content = toFrontmatter(page) + page.body;
    await fs.writeFile(tmpPath, content, 'utf-8');
    await fs.rename(tmpPath, filePath);
    Logger.debug('WikiManager', `Page saved: ${page.folder ? page.folder + '/' : ''}${page.slug}`);
  }

  /**
   * Load a single page by slug. Returns null if not found.
   */
  public static async loadPage(slug: string): Promise<WikiPage | null> {
    if (!this.storageDir) throw new Error('WikiManager not initialized');
    
    // We might not know the folder. Let's do a search or assume flat if no folder passed.
    // For proper support, we should find the file.
    const allFiles = await getFilesRecursive(this.storageDir);
    const matchingFiles = allFiles.filter(f => path.basename(f, '.md') === slug && !f.endsWith('index.md') && !f.endsWith('log.md'));
    
    if (matchingFiles.length === 0) return null;

    let bestPage: WikiPage | null = null;

    for (const filePath of matchingFiles) {
      try {
        const raw = await fs.readFile(filePath, 'utf-8');
        const { meta, body } = parseFrontmatter(raw);
        const relativePath = path.relative(this.storageDir, filePath);
        const folder = path.dirname(relativePath) === '.' ? undefined : path.dirname(relativePath);
        
        const candidate: WikiPage = {
          slug,
          folder,
          title: meta.title ?? slug,
          body,
          neo4jId: meta.neo4jId,
          tags: Array.isArray(meta.tags) ? meta.tags : [],
          sources: Array.isArray(meta.sources) ? meta.sources : [],
          updatedAt: meta.updatedAt ?? new Date().toISOString(),
        };

        if (!bestPage || candidate.updatedAt > bestPage.updatedAt) {
          bestPage = candidate;
        }
      } catch (e: any) {
        if (e.code !== 'ENOENT') throw e;
      }
    }

    return bestPage;
  }

  /**
   * List all pages (from disk scan). Excludes index.md and log.md.
   */
  public static async listPages(): Promise<WikiPageSummary[]> {
    if (!this.storageDir) throw new Error('WikiManager not initialized');
    
    const allFiles = await getFilesRecursive(this.storageDir);
    const mdFiles = allFiles.filter(
      f => f.endsWith('.md') && !f.endsWith('index.md') && !f.endsWith('log.md')
    );

    const summariesMap = new Map<string, WikiPageSummary>();
    for (const filePath of mdFiles) {
      const slug = path.basename(filePath, '.md');
      try {
        const raw = await fs.readFile(filePath, 'utf-8');
        const { meta } = parseFrontmatter(raw);
        const relativePath = path.relative(this.storageDir, filePath);
        const folder = path.dirname(relativePath) === '.' ? undefined : path.dirname(relativePath);

        const summary: WikiPageSummary = {
          slug,
          folder,
          title: meta.title ?? slug,
          tags: Array.isArray(meta.tags) ? meta.tags : [],
          updatedAt: meta.updatedAt ?? '',
          neo4jId: meta.neo4jId,
        };

        const existing = summariesMap.get(slug);
        if (!existing || summary.updatedAt > existing.updatedAt) {
          summariesMap.set(slug, summary);
        }
      } catch {
        // Skip corrupted files
      }
    }
    return Array.from(summariesMap.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /**
   * Delete a page by slug.
   */
  public static async deletePage(slug: string): Promise<void> {
    const allFiles = await getFilesRecursive(this.storageDir);
    const matchingFiles = allFiles.filter(f => path.basename(f, '.md') === slug && !f.endsWith('index.md') && !f.endsWith('log.md'));
    for (const filePath of matchingFiles) {
      await fs.unlink(filePath).catch(() => null);
    }
  }

  /**
   * Rebuild index.md from current pages on disk.
   */
  public static async rebuildIndex(): Promise<void> {
    const pages = await this.listPages();
    const lines = [
      '# Neural Wiki — Index',
      `_${pages.length} pages. Last rebuilt: ${new Date().toISOString()}_`,
      '',
      '## Pages',
      '',
    ];
    for (const p of pages) {
      const tags = p.tags.length > 0 ? ` · \`${p.tags.join('` `')}\`` : '';
      lines.push(`- [[${p.slug}]] **${p.title}**${tags} _(${p.updatedAt.slice(0, 10)})_`);
    }
    await fs.writeFile(path.join(this.storageDir, 'index.md'), lines.join('\n') + '\n', 'utf-8');
    Logger.debug('WikiManager', `Index rebuilt with ${pages.length} pages`);
  }

  /**
   * Append a structured entry to log.md.
   */
  public static async appendLog(entry: string): Promise<void> {
    const timestamp = new Date().toISOString().slice(0, 10);
    const line = `## [${timestamp}] ${entry}\n`;
    await fs.appendFile(path.join(this.storageDir, 'log.md'), line, 'utf-8');
  }

  /**
   * Read the last N lines from log.md.
   */
  public static async readLog(lastN = 50): Promise<string> {
    try {
      const content = await fs.readFile(path.join(this.storageDir, 'log.md'), 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      return lines.slice(-lastN).join('\n');
    } catch {
      return '';
    }
  }

  /**
   * Read the raw index.md content.
   */
  public static async readIndex(): Promise<string> {
    try {
      return await fs.readFile(path.join(this.storageDir, 'index.md'), 'utf-8');
    } catch {
      return '';
    }
  }

  /**
   * Commit all changes to git (if gitEnabled). Non-blocking on failure.
   */
  public static async commitChanges(message: string): Promise<void> {
    if (!this.gitEnabled) return;
    const cmd = `cd "${this.storageDir}" && git add -A && git commit -m "${message.replace(/"/g, '\\"')}" --allow-empty`;
    exec(cmd, (err, _stdout, stderr) => {
      if (err) {
        Logger.warn('WikiManager', `Git commit failed: ${stderr?.trim() ?? err.message}`);
      } else {
        Logger.debug('WikiManager', `Git commit: ${message}`);
      }
    });
  }
}
