import { v4 as uuidv4 } from 'uuid';
import db from '../db/sqlite';
import { Logger } from '../utils/Logger';
import { config } from '../config';
import { autoEvolutionPipeline } from './AutoEvolutionPipeline';

export type FeedbackSource = 'developer' | 'gitea_comment' | 'system';

export type FeedbackLabel =
  | 'too-aggressive'    // il cambiamento tocca troppo codice
  | 'missing-tests'     // mancano i test
  | 'wrong-file'        // file sbagliato modificato
  | 'keep-signature'    // non cambiare le firme pubbliche
  | 'style-only'        // solo refactoring stilistico, niente logica
  | 'add-logging'       // aggiungere logging
  | 'add-comments'      // aggiungere commenti JSDoc
  | 'revert-safety'     // ripristinare le difese rimosse
  | 'other';

export interface FeedbackRecord {
  id: string;
  proposalId: string;
  source: FeedbackSource;
  author?: string;
  content: string;
  labels: FeedbackLabel[];
  iteration: number;
  createdAt: number;
  applied: boolean;
}

export class FeedbackService {

  private readonly MAX_ITERATIONS =
    config.autoEvolution?.maxFeedbackIterations ?? 5;

  // ── Salvataggio feedback ────────────────────────────────────────────────

  /**
   * Salva un feedback testuale da developer (app mobile / admin panel).
   * Se autoTrigger=true, avvia immediatamente la rigenerazione.
   */
  async saveFeedback(
    proposalId: string,
    content: string,
    options?: {
      author?: string;
      labels?: FeedbackLabel[];
      source?: FeedbackSource;
      autoTrigger?: boolean;
    }
  ): Promise<FeedbackRecord> {
    const proposal = db.prepare(`SELECT * FROM evolution_proposals WHERE id = ?`).get(proposalId) as any;
    if (!proposal) throw new Error(`Proposal ${proposalId} not found`);
    if (proposal.status === 'merged') throw new Error(`Cannot add feedback to a merged proposal`);

    const currentIteration = proposal.iteration_count ?? 0;

    const record: FeedbackRecord = {
      id: uuidv4(),
      proposalId,
      source: options?.source ?? 'developer',
      author: options?.author ?? 'developer',
      content,
      labels: options?.labels ?? [],
      iteration: currentIteration,
      createdAt: Date.now(),
      applied: false,
    };

    db.prepare(`
      INSERT INTO evolution_feedback
      (id, proposal_id, source, author, content, labels, iteration, created_at, applied)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      record.id, record.proposalId, record.source, record.author ?? null,
      record.content, JSON.stringify(record.labels),
      record.iteration, record.createdAt, 0
    );

    // Aggiorna lo stato della proposta
    db.prepare(`
      UPDATE evolution_proposals
      SET feedback_status = 'has_feedback', last_feedback_at = ?
      WHERE id = ?
    `).run(Date.now(), proposalId);

    Logger.info('FeedbackService', `Feedback saved for proposal ${proposalId} (iteration ${currentIteration})`);

    // Trigger automatico se richiesto e sotto il limite di iterazioni
    if (options?.autoTrigger && currentIteration < this.MAX_ITERATIONS) {
      setImmediate(() => autoEvolutionPipeline.regenerateFromFeedback(proposalId));
    }

    return record;
  }

  /**
   * Ingest di un commento Gitea (da webhook).
   * Filtra commenti del bot stesso per evitare loop.
   */
  async ingestGiteaComment(
    proposalId: string,
    comment: string,
    author: string
  ): Promise<void> {
    // Ignora commenti del bot (poiché il bot usa il token dell'owner, controlliamo il contenuto)
    const isBotComment = 
      comment.includes('⚠️ **Iteration') || 
      comment.includes('❌ **Iteration') || 
      comment.includes('🔄 **Iteration') || 
      comment.includes('⚠️ Unable to regenerate') ||
      comment.includes('Evolution Applied');

    if (
      author.toLowerCase() === 'auto-evolution-bot' || 
      author.toLowerCase() === 'aimindmesh' || 
      isBotComment
    ) {
      return;
    }

    // Ignora commenti di sistema Gitea (PR merged/closed notification)
    if (comment.startsWith('*') && comment.includes('merged')) return;

    await this.saveFeedback(proposalId, comment, {
      source: 'gitea_comment',
      author,
      autoTrigger: config.autoEvolution?.feedbackAutoTrigger ?? true,
    });
  }

  // ── Lettura feedback ────────────────────────────────────────────────────

  getFeedbackForProposal(proposalId: string): FeedbackRecord[] {
    const rows = db.prepare(`
      SELECT * FROM evolution_feedback WHERE proposal_id = ? ORDER BY created_at ASC
    `).all(proposalId) as any[];

    return rows.map(row => ({
      ...row,
      proposalId: row.proposal_id,
      createdAt: row.created_at,
      labels: this.parseJSON(row.labels, []),
      applied: row.applied === 1,
    }));
  }

  getUnappliedFeedback(proposalId: string): FeedbackRecord[] {
    return this.getFeedbackForProposal(proposalId).filter(f => !f.applied);
  }

  markFeedbackAsApplied(proposalId: string, iteration: number): void {
    db.prepare(`
      UPDATE evolution_feedback SET applied = 1
      WHERE proposal_id = ? AND iteration <= ?
    `).run(proposalId, iteration);
  }

  canIterate(proposalId: string): boolean {
    const proposal = db.prepare(`SELECT iteration_count FROM evolution_proposals WHERE id = ?`)
      .get(proposalId) as any;
    if (!proposal) return false;
    return (proposal.iteration_count ?? 0) < this.MAX_ITERATIONS;
  }

  incrementIteration(proposalId: string): number {
    db.prepare(`
      UPDATE evolution_proposals
      SET iteration_count = iteration_count + 1,
          feedback_status = 'regenerating'
      WHERE id = ?
    `).run(proposalId);

    const updated = db.prepare(`SELECT iteration_count FROM evolution_proposals WHERE id = ?`)
      .get(proposalId) as any;
    return updated.iteration_count;
  }

  // ── Utility ─────────────────────────────────────────────────────────────

  private parseJSON<T>(raw: string, fallback: T): T {
    try { return JSON.parse(raw); } catch { return fallback; }
  }

  /**
   * Formatta i feedback in testo strutturato per il prompt LLM.
   */
  formatFeedbackForPrompt(feedbacks: FeedbackRecord[]): string {
    if (feedbacks.length === 0) return '';

    const lines: string[] = ['## DEVELOPER FEEDBACK (from previous iterations)'];
    lines.push('The following comments were left by the developer reviewing the generated code.');
    lines.push('You MUST address ALL of them in your new version.\n');

    for (const fb of feedbacks) {
      const labels = fb.labels.length > 0 ? ` [${fb.labels.join(', ')}]` : '';
      lines.push(`### Feedback #${feedbacks.indexOf(fb) + 1}${labels}`);
      lines.push(`**Source:** ${fb.source} | **Iteration:** ${fb.iteration}`);
      lines.push(`**Comment:** ${fb.content}`);
      lines.push('');
    }

    lines.push('---');
    lines.push('> Respond to every feedback point above. If you cannot safely address a specific');
    lines.push('> feedback, explain why in the "explanation" field and propose an alternative.');

    return lines.join('\n');
  }
}

export const feedbackService = new FeedbackService();
