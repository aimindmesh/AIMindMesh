/**
 * Storage of the facts: SQLite (table memory_facts of the 'memory' database) on the device,
 * localStorage on the web build (no SQLite there) and in tests.
 */
import { Fact } from './factTypes';

export interface FactRepository {
    readonly kind: 'sqlite' | 'local';
    init(): Promise<void>;
    loadAll(): Promise<Fact[]>;
    upsert(fact: Fact): Promise<void>;
    upsertMany(facts: Fact[]): Promise<void>;
    remove(ids: string[]): Promise<void>;
    clear(): Promise<void>;
    /** Usage counters only (frequent, cheap) */
    touch(ids: string[], at: number): Promise<void>;
    getMeta(key: string): Promise<string | null>;
    setMeta(key: string, value: string): Promise<void>;
    /** Vectors of `modelKey` (empty where embeddings are unavailable) */
    loadEmbeddings(modelKey: string): Promise<Array<{ id: string; vector: Float32Array }>>;
    /** Facts extracted by older versions into the episodic table (SQLite only) */
    loadLegacyExtracted?(): Promise<Array<{ id: string; sessionId: string; timestamp: number; content: string }>>;
    /** Gives a migrated fact the vector of its source row (same model, no re-embedding) */
    copyEmbedding?(factId: string, sourceMemoryId: string): Promise<void>;
}

const FACTS_KEY = 'memory-facts';
const META_KEY = 'memory-facts-meta';

function readJson<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) as T : fallback;
    } catch {
        return fallback;
    }
}

/** Web / tests: the whole list as one JSON value */
export class LocalFactRepository implements FactRepository {
    readonly kind = 'local' as const;

    async init(): Promise<void> { /* nothing to create */ }

    async loadAll(): Promise<Fact[]> {
        const facts = readJson<Fact[]>(FACTS_KEY, []);
        return Array.isArray(facts) ? facts : [];
    }

    private save(facts: Fact[]): void {
        localStorage.setItem(FACTS_KEY, JSON.stringify(facts));
    }

    async upsert(fact: Fact): Promise<void> {
        await this.upsertMany([fact]);
    }

    async upsertMany(facts: Fact[]): Promise<void> {
        const byId = new Map((await this.loadAll()).map(f => [f.id, f]));
        for (const fact of facts) byId.set(fact.id, fact);
        this.save([...byId.values()]);
    }

    async remove(ids: string[]): Promise<void> {
        const drop = new Set(ids);
        this.save((await this.loadAll()).filter(f => !drop.has(f.id)));
    }

    async clear(): Promise<void> {
        localStorage.removeItem(FACTS_KEY);
    }

    async touch(ids: string[], at: number): Promise<void> {
        const touched = new Set(ids);
        this.save((await this.loadAll()).map(f => touched.has(f.id) ? { ...f, lastUsedAt: at, useCount: (f.useCount || 0) + 1 } : f));
    }

    async getMeta(key: string): Promise<string | null> {
        return readJson<Record<string, string>>(META_KEY, {})[key] ?? null;
    }

    async setMeta(key: string, value: string): Promise<void> {
        localStorage.setItem(META_KEY, JSON.stringify({ ...readJson<Record<string, string>>(META_KEY, {}), [key]: value }));
    }

    async loadEmbeddings(): Promise<Array<{ id: string; vector: Float32Array }>> {
        return [];
    }
}

/** Facts in memory only (the on-device eval harness): nothing reaches the real store */
export class MemoryFactRepository implements FactRepository {
    readonly kind = 'local' as const;
    private facts = new Map<string, Fact>();
    private meta = new Map<string, string>();

    async init(): Promise<void> { /* nothing to create */ }
    async loadAll(): Promise<Fact[]> { return [...this.facts.values()]; }
    async upsert(fact: Fact): Promise<void> { this.facts.set(fact.id, fact); }
    async upsertMany(facts: Fact[]): Promise<void> { for (const f of facts) this.facts.set(f.id, f); }
    async remove(ids: string[]): Promise<void> { for (const id of ids) this.facts.delete(id); }
    async clear(): Promise<void> { this.facts.clear(); }
    async touch(ids: string[], at: number): Promise<void> {
        for (const id of ids) {
            const f = this.facts.get(id);
            if (f) this.facts.set(id, { ...f, lastUsedAt: at, useCount: (f.useCount || 0) + 1 });
        }
    }
    async getMeta(key: string): Promise<string | null> { return this.meta.get(key) ?? null; }
    async setMeta(key: string, value: string): Promise<void> { this.meta.set(key, value); }
    async loadEmbeddings(): Promise<Array<{ id: string; vector: Float32Array }>> { return []; }
}
