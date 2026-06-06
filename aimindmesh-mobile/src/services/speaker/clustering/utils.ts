/**
 * Compute cosine similarity between two vectors.
 */
export function cosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vec1.length; i++) {
        dotProduct += vec1[i] * vec2[i];
        normA += vec1[i] * vec1[i];
        normB += vec2[i] * vec2[i];
    }

    if (normA > 0 && normB > 0) {
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
    return 0;
}

/**
 * Compute average linkage distance between two clusters.
 * Returns 1 - average(cosine similarity) to convert similarity to distance.
 */
export function averageLinkage(cluster1: number[][], cluster2: number[][]): number {
    let totalSimilarity = 0;
    let count = 0;

    for (const vec1 of cluster1) {
        for (const vec2 of cluster2) {
            totalSimilarity += cosineSimilarity(vec1, vec2);
            count++;
        }
    }

    const avgSimilarity = count > 0 ? totalSimilarity / count : 0;
    return 1 - avgSimilarity; // Convert to distance
}

/**
 * Compute centroid of a cluster of embeddings.
 */
export function computeCentroid(embeddings: number[][]): number[] {
    if (embeddings.length === 0) return [];

    const dim = embeddings[0].length;
    const centroid = new Array(dim).fill(0);

    for (const emb of embeddings) {
        for (let i = 0; i < dim; i++) {
            centroid[i] += emb[i];
        }
    }

    // Average and normalize
    let norm = 0;
    for (let i = 0; i < dim; i++) {
        centroid[i] /= embeddings.length;
        norm += centroid[i] * centroid[i];
    }

    norm = Math.sqrt(norm);
    if (norm > 0) {
        for (let i = 0; i < dim; i++) {
            centroid[i] /= norm;
        }
    }

    return centroid;
}
