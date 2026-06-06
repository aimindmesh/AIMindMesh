import { logger } from '../logger';
import { ClusteringAlgorithm } from '../../types';
import { StoredEmbedding, ClusteringResult, ClusteringOptions } from './clustering/types';
import { AhcStrategy } from './clustering/AhcStrategy';
import { SpectralStrategy } from './clustering/SpectralStrategy';
import { IncrementalStrategy } from './clustering/IncrementalStrategy';

// Re-export types for consumers
export * from './clustering/types';

/**
 * Speaker Clustering Service
 * 
 * Refactored to use Strategy pattern for different clustering algorithms.
 */
export class SpeakerClustering {
    private logCallback: (msg: string) => void;
    private algorithms = {
        ahc: new AhcStrategy(),
        spectral: new SpectralStrategy(),
        incremental: new IncrementalStrategy()
    };

    constructor(logCallback: (msg: string) => void = (msg) => logger.log('debug', 'SpeakerClustering', msg)) {
        this.logCallback = logCallback;
    }

    /**
     * Perform Agglomerative Hierarchical Clustering on embeddings (Default).
     */
    public cluster(
        embeddings: StoredEmbedding[],
        options: Omit<ClusteringOptions, 'logCallback'> = {}
    ): ClusteringResult {
        return this.algorithms.ahc.cluster(embeddings, { ...options, logCallback: this.logCallback });
    }

    /**
     * Re-cluster transcript segments using their embeddings.
     */
    public reclusterTranscript(
        segments: Array<{ id: string; embedding?: number[]; timestamp: number; speakerId: number }>,
        options: {
            targetSpeakers?: number;
            distanceThreshold?: number;
        } = {}
    ): Map<string, number> {
        // Filter segments with valid embeddings
        const stored: StoredEmbedding[] = segments
            .filter(s => s.embedding && s.embedding.length > 0)
            .map(s => ({
                id: s.id,
                embedding: s.embedding!,
                timestamp: s.timestamp,
                originalSpeakerId: s.speakerId
            }));

        if (stored.length === 0) {
            this.logCallback('No embeddings available for re-clustering');
            // Return original assignments
            const result = new Map<string, number>();
            for (const s of segments) {
                result.set(s.id, s.speakerId);
            }
            return result;
        }

        const clusterResult = this.cluster(stored, options);

        // For segments without embeddings, use nearest neighbor by timestamp
        const result = new Map<string, number>(clusterResult.speakerAssignments);

        for (const segment of segments) {
            if (!result.has(segment.id)) {
                // Find closest segment with embedding by timestamp
                let closest: StoredEmbedding | null = null;
                let minDiff = Infinity;

                for (const s of stored) {
                    const diff = Math.abs(s.timestamp - segment.timestamp);
                    if (diff < minDiff) {
                        minDiff = diff;
                        closest = s;
                    }
                }

                if (closest) {
                    result.set(segment.id, clusterResult.speakerAssignments.get(closest.id) ?? 0);
                } else {
                    result.set(segment.id, 0);
                }
            }
        }

        return result;
    }

    /**
     * Unified clustering with algorithm selection
     */
    public clusterWithAlgorithm(
        embeddings: StoredEmbedding[],
        algorithm: ClusteringAlgorithm,
        options: Omit<ClusteringOptions, 'logCallback'> = {}
    ): ClusteringResult {
        const fullOptions = { ...options, logCallback: this.logCallback };

        switch (algorithm) {
            case 'spectral':
                return this.algorithms.spectral.cluster(embeddings, fullOptions);
            case 'incremental':
                return this.algorithms.incremental.cluster(embeddings, fullOptions);
            case 'ahc':
            default:
                return this.algorithms.ahc.cluster(embeddings, fullOptions);
        }
    }

    /**
     * Spectral Clustering implementation delegator.
     */
    public spectralCluster(
        embeddings: StoredEmbedding[],
        options: Omit<ClusteringOptions, 'logCallback'> = {}
    ): ClusteringResult {
        return this.algorithms.spectral.cluster(embeddings, { ...options, logCallback: this.logCallback });
    }

    /**
     * Incremental Clustering implementation delegator.
     */
    public incrementalCluster(
        embeddings: StoredEmbedding[],
        options: Omit<ClusteringOptions, 'logCallback'> = {}
    ): ClusteringResult {
        return this.algorithms.incremental.cluster(embeddings, { ...options, logCallback: this.logCallback });
    }

    /**
     * Find the nearest speaker ID for a given embedding vector against a set of centroids.
     * Used for 2-pass diarization (Second Pass: Classification).
     * @param embedding The embedding vector to classify
     * @param centroids Array of centroid vectors (index = speaker ID)
     * @returns The index of the nearest centroid (speaker ID)
     */
    public findNearestSpeaker(embedding: number[], centroids: number[][]): number {
        if (!centroids || centroids.length === 0) return 0;
        if (!embedding || embedding.length === 0) return 0;

        let bestSpeakerId = 0;
        let maxSimilarity = -2.0; // Cosine similarity is [-1, 1]

        // Import locally to avoid circular dependencies if utils not exported
        // But utils functions are not exported from SpeakerClustering, so we need to duplicate or rely on internal access
        // Ideally we should import from utils at top of file. 
        // We can just implement cosine similarity here quickly or assume imports work.
        // Let's implement helper here or check if we can import.
        // utils.ts functions are not exported by SpeakerClustering class but imported at top.
        // We can't access them directly if they are not methods.
        // But we imported { cosineSimilarity } from './clustering/utils' effectively? 
        // No, 'cluster' methods use them.
        // Let's import it properly or re-implement simple dot product.

        // We'll trust that we can import it or just implement it inline for safety.
        const cosineSim = (a: number[], b: number[]) => {
            if (a.length !== b.length) return 0;
            let dot = 0, normA = 0, normB = 0;
            for (let i = 0; i < a.length; i++) {
                dot += a[i] * b[i];
                normA += a[i] * a[i];
                normB += b[i] * b[i];
            }
            if (normA === 0 || normB === 0) return 0;
            return dot / (Math.sqrt(normA) * Math.sqrt(normB));
        };

        for (let i = 0; i < centroids.length; i++) {
            const centroid = centroids[i];
            if (centroid.length === 0) continue;

            const sim = cosineSim(embedding, centroid);
            if (sim > maxSimilarity) {
                maxSimilarity = sim;
                bestSpeakerId = i;
            }
        }

        return bestSpeakerId;
    }
}
