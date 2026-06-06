import { StoredEmbedding, ClusteringResult, ClusteringOptions, IClusteringStrategy } from './types';
import { averageLinkage, computeCentroid } from './utils';

export class AhcStrategy implements IClusteringStrategy {
    cluster(embeddings: StoredEmbedding[], options: ClusteringOptions): ClusteringResult {
        const {
            targetSpeakers,
            distanceThreshold = 0.4, // ~0.6 cosine similarity
            minClusterSize = 1,
            logCallback = () => { }
        } = options;

        if (embeddings.length === 0) {
            return { speakerAssignments: new Map(), speakerCount: 0, centroids: [] };
        }

        logCallback(`Starting AHC clustering with ${embeddings.length} embeddings`);
        logCallback(`Options: targetSpeakers=${targetSpeakers ?? 'auto'}, distanceThreshold=${distanceThreshold}`);

        // Initialize: each embedding is its own cluster
        // clusters[i] contains indices into the embeddings array
        let clusters: number[][] = embeddings.map((_, i) => [i]);

        // AHC: iteratively merge closest clusters
        while (clusters.length > 1) {
            // Stop if we reached target number of speakers
            if (targetSpeakers !== undefined && clusters.length <= targetSpeakers) {
                logCallback(`Reached target speaker count: ${clusters.length}`);
                break;
            }

            // Find two closest clusters
            let minDistance = Infinity;
            let mergeI = -1;
            let mergeJ = -1;

            for (let i = 0; i < clusters.length; i++) {
                for (let j = i + 1; j < clusters.length; j++) {
                    // Compute average linkage distance
                    const clusterVecs1 = clusters[i].map(idx => embeddings[idx].embedding);
                    const clusterVecs2 = clusters[j].map(idx => embeddings[idx].embedding);
                    const dist = averageLinkage(clusterVecs1, clusterVecs2);

                    if (dist < minDistance) {
                        minDistance = dist;
                        mergeI = i;
                        mergeJ = j;
                    }
                }
            }

            // Stop if minimum distance exceeds threshold (and no target specified)
            if (targetSpeakers === undefined && minDistance > distanceThreshold) {
                logCallback(`Stopping: min distance ${minDistance.toFixed(3)} > threshold ${distanceThreshold}`);
                break;
            }

            // Merge clusters i and j
            logCallback(`Merging clusters ${mergeI} and ${mergeJ} (distance: ${minDistance.toFixed(3)})`);
            const merged = [...clusters[mergeI], ...clusters[mergeJ]];

            // Remove j first (larger index), then i
            clusters.splice(mergeJ, 1);
            clusters.splice(mergeI, 1);
            clusters.push(merged);
        }

        // Filter out small clusters if needed
        if (minClusterSize > 1) {
            clusters = clusters.filter(c => c.length >= minClusterSize);
        }

        // Build result
        const speakerAssignments = new Map<string, number>();
        const centroids: number[][] = [];

        // Sort clusters by first timestamp for consistent speaker ordering
        clusters.sort((a, b) => {
            const minTimestampA = Math.min(...a.map(idx => embeddings[idx].timestamp));
            const minTimestampB = Math.min(...b.map(idx => embeddings[idx].timestamp));
            return minTimestampA - minTimestampB;
        });

        for (let speakerId = 0; speakerId < clusters.length; speakerId++) {
            const cluster = clusters[speakerId];
            const clusterEmbeddings = cluster.map(idx => embeddings[idx].embedding);

            // Assign speaker ID to each embedding in this cluster
            for (const idx of cluster) {
                speakerAssignments.set(embeddings[idx].id, speakerId);
            }

            // Compute centroid
            centroids.push(computeCentroid(clusterEmbeddings));

            logCallback(`Speaker ${speakerId}: ${cluster.length} segments`);
        }

        logCallback(`Clustering complete: ${clusters.length} speakers detected`);

        return {
            speakerAssignments,
            speakerCount: clusters.length,
            centroids
        };
    }
}
