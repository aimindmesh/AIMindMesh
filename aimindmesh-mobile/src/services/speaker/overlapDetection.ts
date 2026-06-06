/**
 * Overlap Detection Service
 * Detects overlapping speech segments using VAD and speaker embeddings.
 * Useful for multi-speaker scenarios like meetings and podcasts.
 */

import { logger } from '../logger';

/**
 * Speech segment with speaker info
 */
export interface SpeechSegment {
    id: string;
    startMs: number;
    endMs: number;
    speakerId?: number;
    embedding?: number[];
    confidence?: number;
}

/**
 * Overlap detection result
 */
export interface OverlapResult {
    /** Overlapping segments */
    overlaps: OverlapSegment[];
    /** Total overlap duration in ms */
    totalOverlapMs: number;
    /** Percentage of total duration that is overlapping */
    overlapPercentage: number;
}

/**
 * Detected overlapping segment
 */
export interface OverlapSegment {
    startMs: number;
    endMs: number;
    speakerIds: number[];
    /** Overlap type: 'turn-taking' (brief), 'simultaneous' (extended) */
    type: 'turn-taking' | 'simultaneous';
}

/**
 * Configuration for overlap detection
 */
export interface OverlapConfig {
    /** Minimum overlap duration to report (ms), default 100 */
    minOverlapDurationMs?: number;
    /** Threshold for turn-taking vs simultaneous (ms), default 500 */
    turnTakingThresholdMs?: number;
    /** Whether to use embeddings for speaker verification */
    useEmbeddings?: boolean;
    /** Similarity threshold for same-speaker detection */
    samePersonThreshold?: number;
}

/**
 * Overlap Detection Service
 */
export class OverlapDetectionService {
    private config: Required<OverlapConfig>;

    constructor(config: OverlapConfig = {}) {
        this.config = {
            minOverlapDurationMs: config.minOverlapDurationMs ?? 100,
            turnTakingThresholdMs: config.turnTakingThresholdMs ?? 500,
            useEmbeddings: config.useEmbeddings ?? false,
            samePersonThreshold: config.samePersonThreshold ?? 0.7,
        };
    }

    /**
     * Detect overlapping speech segments
     */
    public detectOverlaps(segments: SpeechSegment[]): OverlapResult {
        if (segments.length < 2) {
            return { overlaps: [], totalOverlapMs: 0, overlapPercentage: 0 };
        }

        logger.log('debug', `Detecting overlaps in ${segments.length} segments`);

        // Sort by start time
        const sorted = [...segments].sort((a, b) => a.startMs - b.startMs);
        const overlaps: OverlapSegment[] = [];

        // Find all overlapping pairs
        for (let i = 0; i < sorted.length; i++) {
            for (let j = i + 1; j < sorted.length; j++) {
                const segA = sorted[i];
                const segB = sorted[j];

                // No more overlaps possible if B starts after A ends
                if (segB.startMs >= segA.endMs) {
                    break;
                }

                // Calculate overlap
                const overlapStart = Math.max(segA.startMs, segB.startMs);
                const overlapEnd = Math.min(segA.endMs, segB.endMs);
                const overlapDuration = overlapEnd - overlapStart;

                if (overlapDuration >= this.config.minOverlapDurationMs) {
                    // Check if same speaker (using embeddings if available)
                    if (this.config.useEmbeddings && segA.embedding && segB.embedding) {
                        const similarity = this.cosineSimilarity(segA.embedding, segB.embedding);
                        if (similarity >= this.config.samePersonThreshold) {
                            // Same speaker - not a real overlap (e.g., diarization error)
                            continue;
                        }
                    }

                    // Also check speakerId if available
                    if (segA.speakerId !== undefined && segB.speakerId !== undefined) {
                        if (segA.speakerId === segB.speakerId) {
                            continue; // Same speaker, skip
                        }
                    }

                    // Classify overlap type
                    const type: 'turn-taking' | 'simultaneous' =
                        overlapDuration < this.config.turnTakingThresholdMs
                            ? 'turn-taking'
                            : 'simultaneous';

                    const speakerIds: number[] = [];
                    if (segA.speakerId !== undefined) speakerIds.push(segA.speakerId);
                    if (segB.speakerId !== undefined) speakerIds.push(segB.speakerId);

                    overlaps.push({
                        startMs: overlapStart,
                        endMs: overlapEnd,
                        speakerIds,
                        type,
                    });
                }
            }
        }

        // Merge adjacent overlaps
        const mergedOverlaps = this.mergeAdjacentOverlaps(overlaps);

        // Calculate statistics
        const totalOverlapMs = mergedOverlaps.reduce((sum, o) => sum + (o.endMs - o.startMs), 0);

        const totalDuration = Math.max(...segments.map(s => s.endMs)) - Math.min(...segments.map(s => s.startMs));
        const overlapPercentage = totalDuration > 0 ? (totalOverlapMs / totalDuration) * 100 : 0;

        logger.log('info', `Detected ${mergedOverlaps.length} overlap regions (${overlapPercentage.toFixed(1)}% of total)`);

        return {
            overlaps: mergedOverlaps,
            totalOverlapMs,
            overlapPercentage,
        };
    }

    /**
     * Merge adjacent/overlapping overlap segments
     */
    private mergeAdjacentOverlaps(overlaps: OverlapSegment[]): OverlapSegment[] {
        if (overlaps.length === 0) return [];

        // Sort by start time
        const sorted = [...overlaps].sort((a, b) => a.startMs - b.startMs);
        const merged: OverlapSegment[] = [{ ...sorted[0] }];

        for (let i = 1; i < sorted.length; i++) {
            const current = sorted[i];
            const last = merged[merged.length - 1];

            // Merge if overlapping or adjacent
            if (current.startMs <= last.endMs + 50) { // 50ms gap tolerance
                last.endMs = Math.max(last.endMs, current.endMs);
                // Merge speaker IDs
                for (const id of current.speakerIds) {
                    if (!last.speakerIds.includes(id)) {
                        last.speakerIds.push(id);
                    }
                }
                // Upgrade type if any is simultaneous
                if (current.type === 'simultaneous') {
                    last.type = 'simultaneous';
                }
            } else {
                merged.push({ ...current });
            }
        }

        return merged;
    }

    /**
     * Analyze VAD results for multi-speaker activity
     * @param vadResults Array of VAD results with timestamps
     */
    public analyzeMultiSpeakerActivity(
        vadResults: Array<{ timestampMs: number; isSpeech: boolean; channelId?: number }>
    ): { peakActivityMs: number; averageActive: number } {
        if (vadResults.length === 0) {
            return { peakActivityMs: 0, averageActive: 0 };
        }

        // Group by timestamp windows (100ms)
        const windowSize = 100;
        const windows = new Map<number, Set<number>>();

        for (const result of vadResults) {
            if (!result.isSpeech) continue;

            const windowKey = Math.floor(result.timestampMs / windowSize) * windowSize;
            if (!windows.has(windowKey)) {
                windows.set(windowKey, new Set());
            }
            windows.get(windowKey)!.add(result.channelId ?? 0);
        }

        // Find peak and average
        let maxActive = 0;
        let totalActive = 0;

        for (const channels of windows.values()) {
            maxActive = Math.max(maxActive, channels.size);
            totalActive += channels.size;
        }

        const averageActive = windows.size > 0 ? totalActive / windows.size : 0;

        // Find when peak occurred
        let peakActivityMs = 0;
        for (const [windowMs, channels] of windows.entries()) {
            if (channels.size === maxActive) {
                peakActivityMs = windowMs;
                break;
            }
        }

        return { peakActivityMs, averageActive };
    }

    /**
     * Compute cosine similarity between two vectors
     */
    private cosineSimilarity(vec1: number[], vec2: number[]): number {
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
     * Update configuration
     */
    public setConfig(config: Partial<OverlapConfig>): void {
        this.config = { ...this.config, ...config };
    }
}

// Singleton instance
let _overlapService: OverlapDetectionService | null = null;

/**
 * Get the singleton overlap detection service
 */
export function getOverlapDetectionService(): OverlapDetectionService {
    if (!_overlapService) {
        _overlapService = new OverlapDetectionService();
    }
    return _overlapService;
}
