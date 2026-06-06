import { StoredEmbedding, ClusteringResult, ClusteringOptions, IClusteringStrategy } from './types';
import { cosineSimilarity } from './utils';

export class IncrementalStrategy implements IClusteringStrategy {
    cluster(embeddings: StoredEmbedding[], options: ClusteringOptions): ClusteringResult {
        const {
            distanceThreshold = 0.35, // Tighter threshold for real-time
            minClusterSize = 1,
            logCallback = () => { }
        } = options;

        if (embeddings.length === 0) {
            return { speakerAssignments: new Map(), speakerCount: 0, centroids: [] };
        }

        logCallback(`Starting Incremental clustering with ${embeddings.length} embeddings`);

        // Sort by timestamp for proper incremental processing
        const sorted = [...embeddings].sort((a, b) => a.timestamp - b.timestamp);

        const clusters: { indices: number[]; centroid: number[] }[] = [];
        const speakerAssignments = new Map<string, number>();

        for (let i = 0; i < sorted.length; i++) {
            const emb = sorted[i];
            const embedding = emb.embedding;

            // Find nearest cluster
            let bestCluster = -1;
            let bestSimilarity = -1;

            for (let c = 0; c < clusters.length; c++) {
                const sim = cosineSimilarity(embedding, clusters[c].centroid);
                if (sim > bestSimilarity) {
                    bestSimilarity = sim;
                    bestCluster = c;
                }
            }

            // Check if similar enough to existing cluster
            if (bestCluster >= 0 && (1 - bestSimilarity) <= distanceThreshold) {
                // Add to existing cluster
                clusters[bestCluster].indices.push(i);

                // Update centroid incrementally
                const n = clusters[bestCluster].indices.length;
                const oldCentroid = clusters[bestCluster].centroid;
                const newCentroid = new Array(embedding.length);

                for (let d = 0; d < embedding.length; d++) {
                    newCentroid[d] = oldCentroid[d] + (embedding[d] - oldCentroid[d]) / n;
                }

                // Normalize
                let norm = 0;
                for (let d = 0; d < newCentroid.length; d++) {
                    norm += newCentroid[d] * newCentroid[d];
                }
                norm = Math.sqrt(norm);
                if (norm > 0) {
                    for (let d = 0; d < newCentroid.length; d++) {
                        newCentroid[d] /= norm;
                    }
                }

                clusters[bestCluster].centroid = newCentroid;
            } else {
                // Create new cluster
                clusters.push({
                    indices: [i],
                    centroid: [...embedding]
                });
            }
        }

        // Filter small clusters
        const validClusters = clusters.filter(c => c.indices.length >= minClusterSize);

        // Build assignments
        const centroids: number[][] = [];

        for (let speakerId = 0; speakerId < validClusters.length; speakerId++) {
            centroids.push(validClusters[speakerId].centroid);

            for (const idx of validClusters[speakerId].indices) {
                speakerAssignments.set(sorted[idx].id, speakerId);
            }

            logCallback(`Incremental Speaker ${speakerId}: ${validClusters[speakerId].indices.length} segments`);
        }

        logCallback(`Incremental clustering complete: ${validClusters.length} speakers`);

        return {
            speakerAssignments,
            speakerCount: validClusters.length,
            centroids
        };
    }
}
