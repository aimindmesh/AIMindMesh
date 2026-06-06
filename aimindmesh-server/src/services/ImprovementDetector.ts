import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { minimatch } from 'minimatch';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../utils/Logger';
import { getSession } from '../db/neo4j';
import db from '../db/sqlite';
import { InferenceRouter } from './InferenceRouter';
import { InferenceRegistry } from './InferenceRegistry';
import { config } from '../config';
import { WikiManager } from './WikiManager';
import { Parser } from '../utils/Parser';

export interface ImprovementCandidate {
  id: string;
  source: "open_question" | "low_confidence_insight" | "debate_conclusion" | "manual";
  sourceId: string;
  title: string;
  description: string;
  targetComponent: string;
  affectedComponents?: string[];   // ★ NEW: explicit list of files involved
  changeScope?: 'single_file' | 'multi_file' | 'interface_change' | 'db_migration'; // ★ NEW
  repository: string;
  targetLanguage: "typescript" | "kotlin" | "rust";
  severity: number;
  confidence: number;
  proposedApproach?: string;
  tags: string[];
  createdAt: number;
  status: "pending" | "queued" | "generating" | "validating" | "proposed" | "merged" | "rejected" | "failed";
}


const CANDIDATE_EXTRACTION_PROMPT = (content: string, fileList: string[]) => `
You are an expert software architect analyzing an AI-generated insight about a codebase.

INSIGHT:
${content}

AVAILABLE FILES IN THE TARGET REPOSITORY (aimindmesh-server):
${fileList.map(f => `- ${f}`).join('\n')}

Extract from this insight a structured improvement candidate.
Respond ONLY with valid JSON matching this schema:

{
  "title": "short title of the improvement (max 10 words)",
  "description": "full description of what needs to change and why",
  "repository": "the Gitea repository name (must be 'AIMindMesh')",
  "targetComponent": "relative Gitea path to the file most likely needing modification (MUST be selected from the AVAILABLE FILES list above, e.g. aimindmesh-server/src/services/WikiManager.ts)",
  "affectedComponents": ["array", "of", "other", "files", "likely", "involved", "selected", "from", "the", "AVAILABLE FILES", "list"],
  "changeScope": "single_file | multi_file | interface_change | db_migration",
  "targetLanguage": "typescript | kotlin | rust",
  "proposedApproach": "brief sketch of how to implement the improvement",
  "tags": ["array", "of", "relevant", "tags"]
}

Strict Rules:
1. "targetComponent" and all items in "affectedComponents" MUST be chosen from the AVAILABLE FILES list above.
2. If the insight does not map to a specific existing file in the list or is about another repository/component, return: {"skip": true}
`.trim();

export class ImprovementDetector {
  public static init() {
    InferenceRouter.onTaskCompleted(async (id: string, result: string, metadata: any, type: any) => {
      // Check if this was an improvement detection task by name
      const task = InferenceRegistry.get(id);
      if (task?.taskName?.startsWith('Improvement Detection:')) {
        Logger.info('ImprovementDetector', `Intercepted completed task [${id.slice(0, 8)}], processing as candidate...`);
        await this.handleManualResult(task.sourceId || id, result, task.taskName);
      }
    });
  }

  private static async handleManualResult(sourceId: string, result: string, taskName: string) {
    try {
      const parsed = Parser.parseLLMJson(result);
      if (parsed.skip) return;

      const title = parsed.title;
      const deterministicId = this.generateDeterministicId(sourceId, title);

      const candidate: ImprovementCandidate = {
        id: deterministicId,
        source: sourceId.startsWith('wiki:') ? 'open_question' : 'debate_conclusion',
        sourceId: sourceId,
        title: parsed.title,
        description: parsed.description,
        repository: parsed.repository ?? 'AIMindMesh',
        targetComponent: parsed.targetComponent,
        affectedComponents: parsed.affectedComponents ?? [],
        changeScope: parsed.changeScope ?? 'single_file',
        targetLanguage: parsed.targetLanguage ?? 'typescript',
        severity: 7, // Default for manual/intercepted
        confidence: 0.8, // Default for manual/intercepted
        proposedApproach: parsed.proposedApproach,
        tags: parsed.tags ?? [],
        createdAt: Date.now(),
        status: 'pending'
      };


      // Persist to DB directly
      db.prepare(`
        INSERT OR IGNORE INTO evolution_candidates 
          (id, source, source_id, title, description, repository, target_component, target_language, severity, confidence, proposed_approach, tags, affected_components, change_scope, created_at, status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        candidate.id, candidate.source, candidate.sourceId, candidate.title, 
        candidate.description, candidate.repository, candidate.targetComponent, candidate.targetLanguage, 
        candidate.severity, candidate.confidence, candidate.proposedApproach, 
        JSON.stringify(candidate.tags),
        JSON.stringify(candidate.affectedComponents || []),
        candidate.changeScope || 'single_file',
        candidate.createdAt, candidate.status
      );
      
      Logger.info('ImprovementDetector', `Manually intercepted candidate persisted: ${candidate.title} [${candidate.id.slice(0, 8)}]`);
    } catch (e: any) {
      Logger.error('ImprovementDetector', `Failed to process intercepted result: ${e.message}`);
    }
  }

  public static generateDeterministicId(sourceId: string, title: string): string {
    return crypto.createHash('sha256')
      .update(`${sourceId}:${title}`)
      .digest('hex');
  }

  private readonly SEVERITY_THRESHOLD = config.autoEvolution?.minSeverityThreshold ?? 6;
  private readonly CONFIDENCE_THRESHOLD = config.autoEvolution?.minConfidenceThreshold ?? 0.65;
  private readonly repoPath = config.autoEvolution?.repoLocalPath ?? path.join(__dirname, '../../');

  async detectCandidates(onCandidateDetected?: (c: ImprovementCandidate) => void): Promise<ImprovementCandidate[]> {
    const candidates: ImprovementCandidate[] = [];
    const session = getSession();

    try {
      // 1. Open Questions from Wiki pages or general insights
      const openQuestionsRes = await session.run(`
        MATCH (i:Insight)
        WHERE (i.type = 'open_question' OR i.type = 'observation')
          AND i.severity >= $threshold
          AND (i.processed IS NULL OR i.processed = false)
        RETURN i
        ORDER BY i.severity DESC
        LIMIT 10
      `, { threshold: this.SEVERITY_THRESHOLD });

      for (const record of openQuestionsRes.records) {
        const node = record.get('i');
        const candidate = await this.buildCandidate(node.properties, node.identity.toString(), "open_question");
        if (candidate && !(await this.isProtected(candidate.targetComponent))) {
          candidates.push(candidate);
          if (onCandidateDetected) onCandidateDetected(candidate);
        }
      }

      // 2. DebateEngine conclusions
      const debateConclusionsRes = await session.run(`
        MATCH (i:Insight)
        WHERE i.source = 'DebateEngine'
          AND (i.developerConclusion IS NOT NULL OR i.content IS NOT NULL)
          AND i.confidence >= $conf
          AND (i.processed IS NULL OR i.processed = false)
        RETURN i
        ORDER BY i.createdAt DESC
        LIMIT 5
      `, { conf: this.CONFIDENCE_THRESHOLD });

      for (const record of debateConclusionsRes.records) {
        const node = record.get('i');
        const candidate = await this.buildCandidate(node.properties, node.identity.toString(), "debate_conclusion");
        if (candidate && !(await this.isProtected(candidate.targetComponent))) {
          candidates.push(candidate);
          if (onCandidateDetected) onCandidateDetected(candidate);
        }
      }

      // 3. Neural Wiki Open Questions (Markdown)
      const wikiCandidates = await this.scanWikiForCandidates(onCandidateDetected);
      candidates.push(...wikiCandidates);

    } catch (err: any) {
      Logger.error('ImprovementDetector', `Detection failed: ${err.message}`);
    } finally {
      await session.close();
    }

    return candidates;
  }

  private async scanWikiForCandidates(onCandidateDetected?: (c: ImprovementCandidate) => void): Promise<ImprovementCandidate[]> {
    const wikiCandidates: ImprovementCandidate[] = [];
    try {
      const pages = await WikiManager.listPages();
      // Scan most recent 10 pages for open questions
      for (const summary of pages.slice(0, 10)) {
        const page = await WikiManager.loadPage(summary.slug);
        if (!page) continue;

        const openQuestionsSection = this.extractSection(page.body, 'Open Questions');
        if (openQuestionsSection && openQuestionsSection.length > 50) {
          const candidate = await this.buildCandidate(
            { content: openQuestionsSection, severity: 7, confidence: 0.7 },
            `wiki:${page.slug}`,
            "open_question"
          );
          if (candidate && !(await this.isProtected(candidate.targetComponent))) {
            wikiCandidates.push(candidate);
            if (onCandidateDetected) onCandidateDetected(candidate);
          }
        }
      }
    } catch (e: any) {
      Logger.warn('ImprovementDetector', `Wiki scan failed: ${e.message}`);
    }
    return wikiCandidates;
  }

  private extractSection(content: string, sectionTitle: string): string | null {
    const lines = content.split('\n');
    let inSection = false;
    const sectionLines: string[] = [];

    for (const line of lines) {
      if (line.trim().startsWith('## ') && line.includes(sectionTitle)) {
        inSection = true;
        continue;
      }
      if (inSection && line.trim().startsWith('## ')) {
        break;
      }
      if (inSection) {
        sectionLines.push(line);
      }
    }

    return sectionLines.length > 0 ? sectionLines.join('\n').trim() : null;
  }

  private async isProtected(targetPath: string): Promise<boolean> {
    // Check .noautoedit file
    const protectedPaths = this.loadNoAutoEdit();
    const fileProtected = protectedPaths.some(p => minimatch(targetPath, p));
    if (fileProtected) return true;

    // Check runtime DB
    try {
      const dbProtected = db.prepare(
        `SELECT 1 FROM protected_paths WHERE ? LIKE path || '%'`
      ).get(targetPath);
      if (dbProtected) return true;
    } catch (e) {}

    return false;
  }

  private loadNoAutoEdit(): string[] {
    try {
      const filePath = path.join(this.repoPath, '.noautoedit');
      if (!fs.existsSync(filePath)) return [];
      const content = fs.readFileSync(filePath, 'utf-8');
      return content
        .split('\n')
        .map((l: string) => l.trim())
        .filter((l: string) => l && !l.startsWith('#'));
    } catch (e) {
      return [];
    }
  }

  private getWorkspaceFiles(): string[] {
    const files: string[] = [];
    const walk = (dir: string) => {
      try {
        const list = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of list) {
          const fullPath = path.join(dir, item.name);
          const relPath = path.relative(this.repoPath, fullPath);
          
          if (item.isDirectory()) {
            if (['node_modules', '.git', 'dist', 'data', 'backups', 'coverage', 'build'].includes(item.name)) {
              continue;
            }
            walk(fullPath);
          } else {
            const ext = path.extname(item.name);
            if (['.ts', '.tsx', '.js', '.jsx', '.json', '.kt', '.kts', '.rs', '.gradle', '.xml', '.yml', '.yaml'].includes(ext)) {
              files.push(`aimindmesh-server/${relPath}`);
            }
          }
        }
      } catch (err) {
        // Ignore read errors
      }
    };
    walk(this.repoPath);
    return files;
  }

  private async buildCandidate(
    properties: any,
    neo4jId: string,
    source: ImprovementCandidate['source']
  ): Promise<ImprovementCandidate | null> {
    const content = properties.developerConclusion || properties.content;
    
    // Use InferenceRouter (LIGHTWEIGHT) to extract structured metadata
    try {
      const fileList = this.getWorkspaceFiles();
      const res = await InferenceRouter.complete(
        CANDIDATE_EXTRACTION_PROMPT(content, fileList), 
        'IMPROVEMENT_DETECTION', 
        { taskName: `Improvement Detection: ${neo4jId.slice(0, 15)}...` },
        { sourceId: neo4jId } 
      );
      const parsed = Parser.parseLLMJson(res);
      
      if (parsed.skip) return null;

      const title = parsed.title;
      const deterministicId = ImprovementDetector.generateDeterministicId(neo4jId, title);

      return {
        id: deterministicId,
        source,
        sourceId: neo4jId,
        title: title,
        description: parsed.description,
        repository: parsed.repository ?? 'AIMindMesh',
        targetComponent: parsed.targetComponent,
        affectedComponents: parsed.affectedComponents ?? [],
        changeScope: parsed.changeScope ?? 'single_file',
        targetLanguage: parsed.targetLanguage ?? 'typescript',
        severity: properties.severity ?? 5,
        confidence: properties.confidence ?? 0.5,
        proposedApproach: parsed.proposedApproach,
        tags: parsed.tags ?? [],
        createdAt: Date.now(),
        status: 'pending'
      };

    } catch (err: any) {
      Logger.error('ImprovementDetector', `Failed to build candidate for ${neo4jId}: ${err.message}`);
      return null;
    }
  }
}
