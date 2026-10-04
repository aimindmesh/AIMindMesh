/**
 * Similarity thresholds of the memory search, per embedding model. Cosine scales differ by
 * model: E5 (trained with a low temperature) scores unrelated Italian sentences around
 * 0.75–0.8, so the old shared 0.75 let unrelated rows in and the recall's 0.6 returned whatever
 * was stored; MiniLM scores much lower. A threshold set by hand in Settings wins.
 *
 * E5 measured on the Fold7 (multilingual-e5-small, query/passage prefixes, 25 Italian
 * question/memory pairs vs 850 non-matching ones, eval/calibrate.eval.ts): matching median
 * 0.845, non-matching median 0.785 and 95th percentile 0.82 → related 0.82 (≤ 5 % of the
 * non-matching pairs pass, 80 % of the matching ones), recall 0.81 (≤ 10 %, 84 %). MiniLM and
 * BGE are not calibrated (no such model in use).
 */
import { modelSource } from '../../model/embedding/modelSources';

export interface MemoryThresholds {
    /** Memories and facts related to an ordinary message */
    related: number;
    /** "Do you remember…?": a looser search */
    recall: number;
}

const BY_FAMILY: Array<[RegExp, MemoryThresholds]> = [
    [/e5/i, { related: 0.82, recall: 0.81 }],
    [/minilm/i, { related: 0.5, recall: 0.45 }],
    [/bge/i, { related: 0.7, recall: 0.65 }],
];

/** Models of unknown scale keep the old values */
const DEFAULT: MemoryThresholds = { related: 0.75, recall: 0.6 };

export function memoryThresholds(config: { embeddingModelId?: string; semanticMemorySimilarityThreshold?: number } | null | undefined): MemoryThresholds {
    const manual = config?.semanticMemorySimilarityThreshold;
    if (manual && manual > 0) return { related: manual, recall: Math.max(0, manual - 0.02) };
    const id = config?.embeddingModelId ?? '';
    // Imported models are known by their config.json too ("memories3" is an E5)
    const names = [id, modelSource(id) ?? ''];
    return BY_FAMILY.find(([pattern]) => names.some(n => pattern.test(n)))?.[1] ?? DEFAULT;
}
