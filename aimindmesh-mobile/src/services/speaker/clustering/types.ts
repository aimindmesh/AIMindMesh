/**
 * Stored embedding with metadata for clustering
 */
export interface StoredEmbedding {
    id: string;
    embedding: number[];
    timestamp: number;
    originalSpeakerId?: number; // From online identification
}

/**
 * Clustering result
 */
export interface ClusteringResult {
    /** Map from embedding ID to speaker ID */
    speakerAssignments: Map<string, number>;
    /** Number of speakers detected */
    speakerCount: number;
    /** Centroids for each speaker (for reference) */
    centroids: number[][];
}

export interface ClusteringOptions {
    /** Target number of speakers (if known). If not set, uses distanceThreshold. */
    targetSpeakers?: number;
    /** Distance threshold to stop merging (default 0.4 = 0.6 similarity) */
    distanceThreshold?: number;
    /** Minimum cluster size to keep (default 1) */
    minClusterSize?: number;
    /** Callback for logging */
    logCallback?: (msg: string) => void;
}

export interface IClusteringStrategy {
    cluster(embeddings: StoredEmbedding[], options: ClusteringOptions): ClusteringResult;
}
