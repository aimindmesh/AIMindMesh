import { StoredEmbedding, ClusteringResult, ClusteringOptions, IClusteringStrategy } from './types';
import { cosineSimilarity, computeCentroid } from './utils';

export class SpectralStrategy implements IClusteringStrategy {
    cluster(embeddings: StoredEmbedding[], options: ClusteringOptions): ClusteringResult {
        const {
            targetSpeakers,
            minClusterSize = 1,
            logCallback = () => { }
        } = options;

        if (embeddings.length === 0) {
            return { speakerAssignments: new Map(), speakerCount: 0, centroids: [] };
        }

        logCallback(`Starting Spectral clustering with ${embeddings.length} embeddings`);

        const n = embeddings.length;

        // Step 1: Build similarity matrix (Gaussian kernel)
        const sigma = 0.5; // Kernel width
        const W: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));

        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i !== j) {
                    const sim = cosineSimilarity(embeddings[i].embedding, embeddings[j].embedding);
                    // Gaussian kernel: exp(-dist^2 / (2 * sigma^2))
                    const dist = 1 - sim;
                    W[i][j] = Math.exp(-(dist * dist) / (2 * sigma * sigma));
                }
            }
        }

        // Step 2: Compute degree matrix and Laplacian
        const D: number[] = W.map(row => row.reduce((a, b) => a + b, 0));

        // Normalized Laplacian: L = I - D^(-1/2) * W * D^(-1/2)
        const L: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));

        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) {
                    L[i][j] = 1; // Identity diagonal
                } else if (D[i] > 0 && D[j] > 0) {
                    L[i][j] = -W[i][j] / Math.sqrt(D[i] * D[j]);
                }
            }
        }

        // Step 3: Power iteration to find k smallest eigenvectors
        const k = targetSpeakers ?? Math.min(Math.ceil(Math.sqrt(n / 2)), 10);
        const U = this.powerIterationEigenvectors(L, k, n);

        // Step 4: K-means clustering on eigenvector rows
        const assignments = this.kMeansClustering(U, k);

        // Build result
        let clusters: number[][] = [];
        for (let i = 0; i < k; i++) {
            clusters.push([]);
        }

        for (let i = 0; i < n; i++) {
            clusters[assignments[i]].push(i);
        }

        // Filter empty and small clusters
        clusters = clusters.filter(c => c.length >= minClusterSize);

        // Sort by first timestamp
        clusters.sort((a, b) => {
            const minTimestampA = Math.min(...a.map(idx => embeddings[idx].timestamp));
            const minTimestampB = Math.min(...b.map(idx => embeddings[idx].timestamp));
            return minTimestampA - minTimestampB;
        });

        const speakerAssignments = new Map<string, number>();
        const centroids: number[][] = [];

        for (let speakerId = 0; speakerId < clusters.length; speakerId++) {
            const cluster = clusters[speakerId];
            const clusterEmbeddings = cluster.map(idx => embeddings[idx].embedding);

            for (const idx of cluster) {
                speakerAssignments.set(embeddings[idx].id, speakerId);
            }

            centroids.push(computeCentroid(clusterEmbeddings));
            logCallback(`Spectral Speaker ${speakerId}: ${cluster.length} segments`);
        }

        logCallback(`Spectral clustering complete: ${clusters.length} speakers`);

        return { speakerAssignments, speakerCount: clusters.length, centroids };
    }

    /**
     * Simplified power iteration for eigenvectors (for spectral clustering)
     */
    private powerIterationEigenvectors(L: number[][], k: number, n: number): number[][] {
        const U: number[][] = Array(n).fill(null).map(() => Array(k).fill(0));

        // Initialize with random vectors
        for (let j = 0; j < k; j++) {
            for (let i = 0; i < n; i++) {
                U[i][j] = Math.random() - 0.5;
            }
        }

        // Simple power iteration (approximate)
        const iterations = 50;
        for (let iter = 0; iter < iterations; iter++) {
            // Matrix-vector multiplication: L * U
            const newU: number[][] = Array(n).fill(null).map(() => Array(k).fill(0));

            for (let i = 0; i < n; i++) {
                for (let j = 0; j < k; j++) {
                    let sum = 0;
                    for (let m = 0; m < n; m++) {
                        sum += L[i][m] * U[m][j];
                    }
                    newU[i][j] = sum;
                }
            }

            // Normalize columns
            for (let j = 0; j < k; j++) {
                let norm = 0;
                for (let i = 0; i < n; i++) {
                    norm += newU[i][j] * newU[i][j];
                }
                norm = Math.sqrt(norm);
                if (norm > 0) {
                    for (let i = 0; i < n; i++) {
                        U[i][j] = newU[i][j] / norm;
                    }
                }
            }
        }

        // Normalize rows for k-means
        for (let i = 0; i < n; i++) {
            let norm = 0;
            for (let j = 0; j < k; j++) {
                norm += U[i][j] * U[i][j];
            }
            norm = Math.sqrt(norm);
            if (norm > 0) {
                for (let j = 0; j < k; j++) {
                    U[i][j] /= norm;
                }
            }
        }

        return U;
    }

    /**
     * Simple K-means clustering
     */
    private kMeansClustering(data: number[][], k: number): number[] {
        const n = data.length;
        const dim = data[0].length;

        // Initialize centroids randomly
        const centroids: number[][] = [];
        const usedIndices = new Set<number>();

        for (let i = 0; i < k && i < n; i++) {
            let idx = Math.floor(Math.random() * n);
            while (usedIndices.has(idx)) {
                idx = (idx + 1) % n;
            }
            usedIndices.add(idx);
            centroids.push([...data[idx]]);
        }

        const assignments = new Array(n).fill(0);
        const maxIterations = 100;

        for (let iter = 0; iter < maxIterations; iter++) {
            // Assign points to nearest centroid
            let changed = false;
            for (let i = 0; i < n; i++) {
                let minDist = Infinity;
                let bestCluster = 0;

                for (let c = 0; c < centroids.length; c++) {
                    let dist = 0;
                    for (let d = 0; d < dim; d++) {
                        const diff = data[i][d] - centroids[c][d];
                        dist += diff * diff;
                    }
                    if (dist < minDist) {
                        minDist = dist;
                        bestCluster = c;
                    }
                }

                if (assignments[i] !== bestCluster) {
                    assignments[i] = bestCluster;
                    changed = true;
                }
            }

            if (!changed) break;

            // Update centroids
            const counts = new Array(k).fill(0);
            const sums: number[][] = centroids.map(() => new Array(dim).fill(0));

            for (let i = 0; i < n; i++) {
                const c = assignments[i];
                counts[c]++;
                for (let d = 0; d < dim; d++) {
                    sums[c][d] += data[i][d];
                }
            }

            for (let c = 0; c < centroids.length; c++) {
                if (counts[c] > 0) {
                    for (let d = 0; d < dim; d++) {
                        centroids[c][d] = sums[c][d] / counts[c];
                    }
                }
            }
        }

        return assignments;
    }
}
