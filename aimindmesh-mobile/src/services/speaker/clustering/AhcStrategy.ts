import { StoredEmbedding, ClusteringResult, ClusteringOptions, IClusteringStrategy } from './types';
import { computeCentroid } from './utils';

function normalize(vector: number[]): Float64Array {
    const out = Float64Array.from(vector);
    let norm = 0;
    for (let i = 0; i < out.length; i++) norm += out[i] * out[i];
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < out.length; i++) out[i] /= norm;
    return out;
}

export class AhcStrategy implements IClusteringStrategy {
    /**
     * Average-linkage agglomerative clustering. Distances live in a matrix updated with the
     * Lance-Williams formula and each row caches its nearest cluster, so a merge costs O(n) instead
     * of recomputing every pairwise linkage (the old O(n^3) loop froze "Diarize Audio").
     */
    cluster(embeddings: StoredEmbedding[], options: ClusteringOptions): ClusteringResult {
        const {
            targetSpeakers,
            distanceThreshold = 0.4, // ~0.6 cosine similarity
            minClusterSize = 1,
            logCallback = () => { }
        } = options;

        const n = embeddings.length;
        if (n === 0) {
            return { speakerAssignments: new Map(), speakerCount: 0, centroids: [] };
        }

        logCallback(`Starting AHC clustering with ${n} embeddings`);
        logCallback(`Options: targetSpeakers=${targetSpeakers ?? 'auto'}, distanceThreshold=${distanceThreshold}`);

        const unit = embeddings.map(e => normalize(e.embedding));
        const distances = new Float32Array(n * n);
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const a = unit[i];
                const b = unit[j];
                let dot = 0;
                if (a.length === b.length) {
                    for (let d = 0; d < a.length; d++) dot += a[d] * b[d];
                }
                const distance = 1 - dot;
                distances[i * n + j] = distance;
                distances[j * n + i] = distance;
            }
        }

        const members: number[][] = embeddings.map((_, i) => [i]);
        const active = new Uint8Array(n).fill(1);
        const nearest = new Int32Array(n).fill(-1);
        const nearestDistance = new Float64Array(n).fill(Infinity);
        let activeCount = n;

        const refreshRow = (i: number) => {
            let best = Infinity;
            let arg = -1;
            for (let k = 0; k < n; k++) {
                if (k === i || !active[k]) continue;
                const d = distances[i * n + k];
                if (d < best) {
                    best = d;
                    arg = k;
                }
            }
            nearest[i] = arg;
            nearestDistance[i] = best;
        };
        for (let i = 0; i < n; i++) refreshRow(i);

        let merges = 0;
        while (activeCount > 1) {
            if (targetSpeakers !== undefined && activeCount <= targetSpeakers) {
                logCallback(`Reached target speaker count: ${activeCount}`);
                break;
            }

            let a = -1;
            let minDistance = Infinity;
            for (let i = 0; i < n; i++) {
                if (active[i] && nearestDistance[i] < minDistance) {
                    minDistance = nearestDistance[i];
                    a = i;
                }
            }
            const b = a >= 0 ? nearest[a] : -1;
            if (a < 0 || b < 0) break;

            if (targetSpeakers === undefined && minDistance > distanceThreshold) {
                logCallback(`Stopping: min distance ${minDistance.toFixed(3)} > threshold ${distanceThreshold}`);
                break;
            }

            // Average linkage of the merged cluster to every other one
            const sizeA = members[a].length;
            const sizeB = members[b].length;
            for (let k = 0; k < n; k++) {
                if (!active[k] || k === a || k === b) continue;
                const merged = (sizeA * distances[a * n + k] + sizeB * distances[b * n + k]) / (sizeA + sizeB);
                distances[a * n + k] = merged;
                distances[k * n + a] = merged;
            }
            members[a] = members[a].concat(members[b]);
            members[b] = [];
            active[b] = 0;
            activeCount--;
            merges++;

            refreshRow(a);
            for (let k = 0; k < n; k++) {
                if (!active[k] || k === a) continue;
                if (nearest[k] === a || nearest[k] === b) {
                    refreshRow(k);
                } else if (distances[k * n + a] < nearestDistance[k]) {
                    nearestDistance[k] = distances[k * n + a];
                    nearest[k] = a;
                }
            }
        }
        logCallback(`AHC performed ${merges} merges`);

        let clusters = members.filter((m, i) => active[i] && m.length > 0);
        if (minClusterSize > 1) {
            clusters = clusters.filter(c => c.length >= minClusterSize);
        }

        // Sort clusters by first timestamp for consistent speaker ordering
        const firstTimestamp = (cluster: number[]) =>
            cluster.reduce((min, idx) => Math.min(min, embeddings[idx].timestamp), Infinity);
        clusters.sort((x, y) => firstTimestamp(x) - firstTimestamp(y));

        const speakerAssignments = new Map<string, number>();
        const centroids: number[][] = [];
        for (let speakerId = 0; speakerId < clusters.length; speakerId++) {
            const cluster = clusters[speakerId];
            for (const idx of cluster) {
                speakerAssignments.set(embeddings[idx].id, speakerId);
            }
            centroids.push(computeCentroid(cluster.map(idx => embeddings[idx].embedding)));
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
