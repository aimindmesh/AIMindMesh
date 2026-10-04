/**
 * Relevance ranking for the web tools: search results (engine order + semantic similarity)
 * and passages of a long page (keywords + semantic similarity), fused by reciprocal rank.
 *
 * Embeddings are used only when the embedding model is already loaded (memory keeps it
 * resident): a web search never loads a model by itself. Without it, keywords decide.
 */

import { logger } from '../logger';
import { embedText, getActiveEmbeddingModel } from '../model/embedding/embeddingRuntime';
import type { SearchResult } from './searchParsers';

const STOPWORDS = new Set([
    // Italian
    'il', 'lo', 'la', 'le', 'gli', 'un', 'una', 'uno', 'di', 'da', 'in', 'con', 'su', 'per', 'tra', 'fra',
    'del', 'della', 'dei', 'delle', 'degli', 'al', 'alla', 'ai', 'alle', 'nel', 'nella', 'nei', 'nelle',
    'sul', 'sulla', 'che', 'chi', 'cosa', 'come', 'dove', 'quando', 'perche', 'quale', 'quali', 'quanto',
    'quanti', 'non', 'piu', 'ma', 'ed', 'se', 'sono', 'era', 'essere', 'questo', 'questa', 'quello', 'mi', 'ti',
    'si', 'ci', 'vi', 'ne', 'oggi',
    // English
    'the', 'an', 'of', 'to', 'and', 'or', 'is', 'are', 'was', 'were', 'be', 'for', 'on', 'at', 'by', 'with',
    'from', 'as', 'it', 'its', 'this', 'that', 'what', 'which', 'who', 'how', 'when', 'where', 'why', 'do',
    'does', 'did', 'can', 'not', 'about', 'into', 'my', 'your', 'me', 'today',
]);

/** Lowercase words without accents and stopwords. */
export function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .split(/[^\p{L}\p{N}]+/u)
        .filter(token => token.length > 1 && !STOPWORDS.has(token));
}

/** BM25 score of each text for the query's words. */
export function keywordScores(query: string, texts: string[]): number[] {
    const terms = [...new Set(tokenize(query))];
    if (terms.length === 0 || texts.length === 0) return texts.map(() => 0);
    const docs = texts.map(tokenize);
    const avgLength = docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length || 1;
    const docFrequency = new Map(terms.map(term => [term, docs.filter(doc => doc.includes(term)).length]));

    return docs.map(doc => {
        const counts = new Map<string, number>();
        for (const token of doc) counts.set(token, (counts.get(token) ?? 0) + 1);
        let score = 0;
        for (const term of terms) {
            const tf = counts.get(term) ?? 0;
            if (tf === 0) continue;
            const df = docFrequency.get(term) ?? 0;
            const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
            score += idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * doc.length / avgLength));
        }
        return score;
    });
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
    let dot = 0, normA = 0, normB = 0;
    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return normA > 0 && normB > 0 ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
}

/** Similarity of each text to the query, or null when no embedding model is loaded (or it fails). */
export async function semanticScores(query: string, texts: string[]): Promise<number[] | null> {
    if (texts.length === 0 || !getActiveEmbeddingModel()) return null;
    try {
        const queryVector = (await embedText(query, 'query')).vector;
        const scores: number[] = [];
        // One at a time: the native plugin serializes them anyway, and each call has its own timeout
        for (const text of texts) {
            scores.push(cosineSimilarity(queryVector, (await embedText(text.slice(0, 1000), 'passage')).vector));
        }
        return scores;
    } catch (error) {
        logger.log('warn', '[WebRanking] Semantic ranking unavailable, using keywords only', error);
        return null;
    }
}

/**
 * Reciprocal rank fusion: indexes of the items, best first, from several score lists
 * (higher score = better), each with its weight (default 1). Ties keep the original order.
 */
export function fuseRankings(scoreLists: number[][], weights: number[] = [], k = 60): number[] {
    const count = scoreLists[0]?.length ?? 0;
    const fused = new Array<number>(count).fill(0);
    scoreLists.forEach((scores, list) => {
        const weight = weights[list] ?? 1;
        const order = scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a] || a - b);
        order.forEach((index, rank) => { fused[index] += weight / (k + rank + 1); });
    });
    return fused.map((_, i) => i).sort((a, b) => fused[b] - fused[a] || a - b);
}

/** Weight of the semantic ranking against the keyword/engine one in the fusion */
const SEMANTIC_WEIGHT = 1.2;

/**
 * Search results best first: the engine's order fused with the semantic similarity of
 * title + snippet. Without embeddings the engine's order stands (it already ranks by keywords).
 */
export async function rerankSearchResults(query: string, results: SearchResult[]): Promise<SearchResult[]> {
    if (results.length < 2) return results;
    const semantic = await semanticScores(query, results.map(r => `${r.title}. ${r.snippet}`));
    if (!semantic) return results;
    const engineOrder = results.map((_, i) => -i);
    // Similarity weighs a little more: the engine matched keywords, the embedding the meaning
    return fuseRankings([engineOrder, semantic], [1, SEMANTIC_WEIGHT]).map(i => ({ ...results[i], similarity: semantic[i] }));
}

/** Passages embedded per page at most (one embedding takes tens of ms on the phone). */
const MAX_SEMANTIC_PASSAGES = 30;

/**
 * Indexes (in page order) of the `count` passages most relevant to the query. Embeddings
 * re-rank the best keyword matches (the start of the page when no word matches); with no
 * keyword match and no embeddings, the first passages.
 */
export async function selectRelevantPassages(query: string, passages: string[], count: number): Promise<number[]> {
    if (passages.length <= count) return passages.map((_, i) => i);
    const keywords = keywordScores(query, passages);
    const hasKeywordMatch = keywords.some(score => score > 0);
    const candidates = (hasKeywordMatch ? fuseRankings([keywords]) : passages.map((_, i) => i)).slice(0, MAX_SEMANTIC_PASSAGES);

    const semantic = await semanticScores(query, candidates.map(i => passages[i]));
    let best: number[];
    if (semantic) {
        const lists = hasKeywordMatch ? [candidates.map(i => keywords[i]), semantic] : [semantic];
        best = fuseRankings(lists, hasKeywordMatch ? [1, SEMANTIC_WEIGHT] : []).map(j => candidates[j]);
    } else {
        best = candidates; // keyword order, or page order without matches
    }
    return best.slice(0, count).sort((a, b) => a - b);
}
