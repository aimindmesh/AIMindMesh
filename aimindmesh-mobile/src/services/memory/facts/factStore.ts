/**
 * The facts the assistant knows about the user, cached in memory (the prompt is built from
 * them on every turn) and persisted by a FactRepository. Every change is written through
 * and announced to subscribers (React hook, server sync).
 */
import { Capacitor } from '@capacitor/core';
import { logger } from '../../logger';
import { newMemoryId } from '../manualMemories';
import { Fact, FactStatus, NewFact, clampImportance, isFactKind, normalizeFactText, MAX_FACT_LENGTH } from './factTypes';
import { FactRepository, LocalFactRepository } from './factRepository';
import { migrateLegacyMemories } from './factMigration';

export type FactChange =
    | { type: 'upsert'; facts: Fact[] }
    | { type: 'remove'; ids: string[] }
    | { type: 'clear' };

type FactsListener = (facts: Fact[]) => void;
type ChangeListener = (change: FactChange) => void;

/** Editable fields of a fact */
export type FactPatch = Partial<Pick<Fact, 'content' | 'kind' | 'subject' | 'category' | 'importance' | 'dueAt' | 'pinned' | 'status'>>;

export interface AddResult {
    fact: Fact;
    /** The same fact was already known: it was reinforced instead of added again */
    duplicate: boolean;
}

function sanitizeContent(content: string): string {
    return content.replace(/\s+/g, ' ').trim().slice(0, MAX_FACT_LENGTH);
}

export class FactStore {
    private facts = new Map<string, Fact>();
    private repo: FactRepository | null = null;
    private readyPromise: Promise<void> | null = null;
    private loaded = false;
    private listeners = new Set<FactsListener>();
    private changeListeners = new Set<ChangeListener>();
    private borrowed = false;

    /** Loads the facts (and migrates the old memories once). Idempotent. */
    init(repo?: FactRepository): Promise<void> {
        if (this.readyPromise) return this.readyPromise;
        this.readyPromise = (async () => {
            const chosen = repo ?? await defaultRepository();
            try {
                await chosen.init();
                this.repo = chosen;
            } catch (e) {
                logger.log('warn', '[FactStore] Database unavailable, keeping facts in local storage', e);
                this.repo = new LocalFactRepository();
            }
            for (const fact of await this.repo.loadAll()) this.facts.set(fact.id, fact);
            const migrated = await migrateLegacyMemories(this.repo).catch(e => {
                logger.log('error', '[FactStore] Migration of the old memories failed', e);
                return [] as Fact[];
            });
            for (const fact of migrated) if (!this.facts.has(fact.id)) this.facts.set(fact.id, fact);
            this.loaded = true;
            logger.log('info', `[FactStore] ${this.facts.size} facts loaded (${migrated.length} migrated)`);
            this.emit(migrated.length > 0 ? { type: 'upsert', facts: migrated } : null);
        })();
        return this.readyPromise;
    }

    /** Resolves once the facts are loaded (immediately after the first load). */
    get ready(): Promise<void> {
        return this.readyPromise ?? this.init();
    }

    isReady(): boolean {
        return this.loaded;
    }

    /** Every fact, oldest first */
    list(): Fact[] {
        return [...this.facts.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    }

    /** Facts that hold now (not replaced, not done, not expired) */
    active(): Fact[] {
        return this.list().filter(f => f.status === 'active');
    }

    get(id: string): Fact | undefined {
        return this.facts.get(id);
    }

    /** Active fact saying the same thing (same kind, same normalized text) */
    findDuplicate(content: string, kind?: string): Fact | undefined {
        const text = normalizeFactText(content);
        return this.active().find(f => normalizeFactText(f.content) === text && (!kind || f.kind === kind));
    }

    async add(input: NewFact): Promise<AddResult | null> {
        await this.ready;
        const content = sanitizeContent(input.content || '');
        if (content.length < 3) return null;
        const kind = isFactKind(input.kind) ? input.kind : 'other';
        const now = Date.now();

        const existing = this.findDuplicate(content, kind);
        if (existing) {
            // Said again: more certain, possibly more important, refreshed
            const reinforced: Fact = {
                ...existing,
                confidence: Math.max(existing.confidence, input.confidence ?? existing.confidence),
                importance: Math.max(existing.importance, clampImportance(input.importance, existing.importance)),
                pinned: existing.pinned || !!input.pinned,
                updatedAt: now,
            };
            await this.put([reinforced]);
            return { fact: reinforced, duplicate: true };
        }

        const fact: Fact = {
            id: input.id ?? newMemoryId(),
            kind,
            subject: input.subject?.trim() || undefined,
            content,
            category: input.category?.trim() || undefined,
            importance: clampImportance(input.importance),
            confidence: Math.min(1, Math.max(0, input.confidence ?? 0.8)),
            source: input.source ?? 'manual',
            sourceThread: input.sourceThread,
            createdAt: now,
            updatedAt: now,
            dueAt: input.dueAt,
            status: input.status ?? 'active',
            supersededBy: undefined,
            pinned: !!input.pinned,
            lastUsedAt: undefined,
            useCount: 0,
        };
        await this.put([fact]);
        return { fact, duplicate: false };
    }

    /** Edits a fact in place (a correction by the user: no history kept). */
    async update(id: string, patch: FactPatch): Promise<Fact | null> {
        await this.ready;
        const current = this.facts.get(id);
        if (!current) return null;
        const updated: Fact = {
            ...current,
            ...patch,
            content: patch.content !== undefined ? sanitizeContent(patch.content) || current.content : current.content,
            kind: isFactKind(patch.kind) ? patch.kind : current.kind,
            importance: patch.importance !== undefined ? clampImportance(patch.importance, current.importance) : current.importance,
            updatedAt: Date.now(),
        };
        await this.put([updated]);
        return updated;
    }

    /**
     * Something changed (new job, new address): the new fact replaces the old one, which is
     * kept as history (status 'superseded').
     */
    async supersede(id: string, replacement: NewFact): Promise<Fact | null> {
        await this.ready;
        const old = this.facts.get(id);
        if (!old) return null;
        const added = await this.add({
            kind: old.kind, subject: old.subject, category: old.category, importance: old.importance,
            pinned: old.pinned, dueAt: old.dueAt, ...replacement,
        });
        if (!added || added.fact.id === old.id) return added?.fact ?? null;
        await this.put([{ ...old, status: 'superseded', supersededBy: added.fact.id, pinned: false, updatedAt: Date.now() }]);
        return added.fact;
    }

    async setStatus(id: string, status: FactStatus): Promise<Fact | null> {
        return this.update(id, { status });
    }

    async remove(ids: string[]): Promise<void> {
        await this.ready;
        const present = ids.filter(id => this.facts.has(id));
        if (present.length === 0) return;
        await this.repo!.remove(present);
        present.forEach(id => this.facts.delete(id));
        this.emit({ type: 'remove', ids: present });
    }

    async clear(): Promise<void> {
        await this.ready;
        await this.repo!.clear();
        this.facts.clear();
        this.emit({ type: 'clear' });
    }

    /** The facts were used in a prompt (ranking of later phases); not announced to listeners */
    async touch(ids: string[]): Promise<void> {
        const present = ids.filter(id => this.facts.has(id));
        if (present.length === 0 || !this.repo) return;
        const now = Date.now();
        for (const id of present) {
            const fact = this.facts.get(id)!;
            this.facts.set(id, { ...fact, lastUsedAt: now, useCount: (fact.useCount || 0) + 1 });
        }
        await this.repo.touch(present, now).catch(e => logger.log('debug', '[FactStore] Usage not saved', e));
    }

    /** Facts restored from a backup: those already known (same id or same text) are skipped. */
    async importFacts(facts: Fact[]): Promise<number> {
        await this.ready;
        const fresh = facts.filter(f => !this.facts.has(f.id) && !this.findDuplicate(f.content, f.kind));
        await this.put(fresh);
        return fresh.length;
    }

    getMeta(key: string): Promise<string | null> {
        return this.ready.then(() => this.repo!.getMeta(key));
    }

    setMeta(key: string, value: string): Promise<void> {
        return this.ready.then(() => this.repo!.setMeta(key, value));
    }

    /** Vectors of the active embedding model (empty on the web build) */
    loadEmbeddings(modelKey: string): Promise<Array<{ id: string; vector: Float32Array }>> {
        return this.ready.then(() => this.repo!.loadEmbeddings(modelKey));
    }

    subscribe(cb: FactsListener): () => void {
        this.listeners.add(cb);
        if (this.loaded) cb(this.list());
        return () => { this.listeners.delete(cb); };
    }

    onChange(cb: ChangeListener): () => void {
        this.changeListeners.add(cb);
        return () => { this.changeListeners.delete(cb); };
    }

    private async put(facts: Fact[]): Promise<void> {
        if (facts.length === 0) return;
        await this.repo!.upsertMany(facts);
        facts.forEach(f => this.facts.set(f.id, f));
        this.emit({ type: 'upsert', facts });
        if (this.repo!.kind === 'sqlite') scheduleFactEmbedding();
    }

    private emit(change: FactChange | null): void {
        const all = this.list();
        this.listeners.forEach(cb => cb(all));
        // Facts of a borrowed repository (eval) never reach the server mirror
        if (change && !this.borrowed) this.changeListeners.forEach(cb => cb(change));
    }

    /**
     * Uses `repo` instead of the real store until the returned restore is called (on-device
     * eval: scenarios bring their own facts). Listeners stay subscribed.
     */
    async useRepository(repo: FactRepository): Promise<() => Promise<void>> {
        await this.ready;
        // Nested borrows would restore the first borrowed store instead of the real one
        if (this.borrowed) throw new Error('The fact store is already borrowed');
        const previous = this.repo;
        await repo.init();
        this.repo = repo;
        this.borrowed = true;
        this.facts.clear();
        for (const fact of await repo.loadAll()) this.facts.set(fact.id, fact);
        this.emit(null);
        return async () => {
            this.repo = previous;
            this.borrowed = false;
            this.facts.clear();
            if (previous) for (const fact of await previous.loadAll()) this.facts.set(fact.id, fact);
            this.emit(null);
        };
    }

    /** Test hook: forget everything and use another repository */
    resetForTests(): void {
        this.facts.clear();
        this.repo = null;
        this.readyPromise = null;
        this.loaded = false;
        this.listeners.clear();
        this.changeListeners.clear();
    }
}

async function defaultRepository(): Promise<FactRepository> {
    if (!Capacitor.isNativePlatform()) return new LocalFactRepository();
    const { SqliteFactRepository } = await import('./sqliteFactRepository');
    return new SqliteFactRepository();
}

/** New or edited facts get their vector from the reindexer (when an embedding model is active) */
function scheduleFactEmbedding(): void {
    import('../../model/embedding/embeddingRuntime')
        .then(({ getActiveEmbeddingModel }) => getActiveEmbeddingModel()
            ? import('../embeddingReindexer').then(m => m.scheduleEmbeddingReindex())
            : undefined)
        .catch(e => logger.log('debug', '[FactStore] Embedding not scheduled', e));
}

export const factStore = new FactStore();
