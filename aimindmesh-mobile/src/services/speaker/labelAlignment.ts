/**
 * Clustering numbers speakers arbitrarily. Each cluster is mapped to the existing speaker id it
 * shares most members with, so the names given to speakers (and the enrolled user as Speaker 0)
 * survive a re-cluster. Clusters with no counterpart get fresh ids from `nextFreeId` on, never an
 * id that already labels other segments.
 */
export function alignClusterLabels(
    pairs: Array<{ previous: number | undefined; cluster: number }>,
    nextFreeId = 0
): Map<number, number> {
    const counts = new Map<string, { cluster: number; previous: number; count: number }>();
    const clusters = new Set<number>();
    let maxPrevious = -1;

    for (const { previous, cluster } of pairs) {
        clusters.add(cluster);
        if (previous === undefined || previous < 0) continue;
        maxPrevious = Math.max(maxPrevious, previous);
        const key = `${cluster}:${previous}`;
        const entry = counts.get(key);
        if (entry) entry.count++;
        else counts.set(key, { cluster, previous, count: 1 });
    }

    const ranked = [...counts.values()].sort(
        (a, b) => b.count - a.count || a.cluster - b.cluster || a.previous - b.previous
    );
    const mapping = new Map<number, number>();
    const used = new Set<number>();
    for (const { cluster, previous } of ranked) {
        if (mapping.has(cluster) || used.has(previous)) continue;
        mapping.set(cluster, previous);
        used.add(previous);
    }

    let next = Math.max(nextFreeId, maxPrevious + 1);
    for (const cluster of [...clusters].sort((a, b) => a - b)) {
        if (mapping.has(cluster)) continue;
        while (used.has(next)) next++;
        mapping.set(cluster, next);
        used.add(next);
        next++;
    }
    return mapping;
}
