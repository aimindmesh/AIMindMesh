import { logger } from '../logger';
import { IncrementalStrategy } from './clustering/IncrementalStrategy';
import { StoredEmbedding } from './clustering/types';

/**
 * Speaker embedding identification using cosine similarity.
 * Matches speaker vectors (from Vosk or ONNX) to known speakers.
 * 
 * IMPROVEMENTS (v2.0):
 * - Higher default threshold (0.80) tuned for ECAPA-TDNN
 * - Rejection threshold (0.50) for definite non-matches
 * - Embedding magnitude validation to reject bad embeddings
 * - User profile (Speaker 0) never drifts toward other speakers
 * - Smarter temporal smoothing that allows clear speaker changes
 */
export class SpeakerEmbedding {
    private speakers: number[][] = [];
    private userProfile: number[] | null = null;
    private hasUserEnrolled = false;

    // Session embedding buffer for offline clustering
    private sessionEmbeddings: Array<{ id: string; embedding: number[]; timestamp: number; speakerId: number }> = [];

    // Configurable parameters - TUNED FOR ECAPA-TDNN
    private threshold = 0.80; // Increased from 0.65 - ECAPA same-speaker typically 0.85-0.95
    private rejectionThreshold = 0.50; // Below this = definitely different speaker
    private adaptationRate = 0.03; // Reduced from 0.05 for more stable profiles

    // Minimum embedding magnitude (L2-normalized should be ~1.0)
    private minEmbeddingMagnitude = 0.5;

    // Temporal smoothing
    private minTimeBetweenSwitches = 1000; // Reduced from 2000ms for faster response
    private lastSpeakerId = 0;
    private lastSwitchTime = 0;

    // Debug statistics
    private lastSimilarityScores: { speakerId: number; score: number }[] = [];

    constructor(
        private logCallback: (msg: string) => void = (msg) => logger.log('debug', 'SpeakerEmbedding', msg)
    ) {
        this.loadUserProfile();
    }

    /**
     * Load user voice profile from localStorage if available.
     * The profile becomes Speaker 0 and is NEVER adapted.
     */
    public loadUserProfile(): void {
        try {
            const storedProfile = localStorage.getItem('user-voice-profile-onnx');
            if (storedProfile) {
                const vector = JSON.parse(storedProfile);
                if (Array.isArray(vector) && vector.length > 0) {
                    this.userProfile = vector;
                    this.hasUserEnrolled = true;
                    // Initialize speakers with user profile as Speaker 0
                    if (this.speakers.length === 0) {
                        this.speakers.push([...this.userProfile]);
                    } else {
                        this.speakers[0] = [...this.userProfile];
                    }
                    this.logCallback(`User voice profile loaded as Speaker 0 (dim: ${vector.length})`);
                }
            }
        } catch (e) {
            this.logCallback('Failed to load user voice profile: ' + e);
        }
    }

    /**
     * Set the similarity threshold for identifying speakers.
     * Higher = stricter matching (fewer false positives)
     * @param value Threshold between 0.5 and 0.95
     */
    public setThreshold(value: number): void {
        this.threshold = Math.max(0.5, Math.min(0.95, value));
        // Rejection threshold is always 0.3 below match threshold
        this.rejectionThreshold = Math.max(0.3, this.threshold - 0.3);
        this.logCallback(`Threshold set to ${this.threshold.toFixed(2)}, rejection at ${this.rejectionThreshold.toFixed(2)}`);
    }

    /**
     * Set minimum time between speaker switches (temporal smoothing).
     * @param ms Time in milliseconds (0 to 10000)
     */
    public setMinTimeBetweenSwitches(ms: number): void {
        this.minTimeBetweenSwitches = Math.max(0, Math.min(10000, ms));
        this.logCallback(`Min switch time set to ${this.minTimeBetweenSwitches}ms`);
    }

    /**
     * Set the adaptation rate for speaker profiles.
     * @param rate Rate between 0.0 and 1.0 (default 0.03)
     */
    public setAdaptationRate(rate: number): void {
        this.adaptationRate = Math.max(0, Math.min(1.0, rate));
        this.logCallback(`Adaptation rate set to ${this.adaptationRate.toFixed(3)}`);
    }

    /**
     * Set minimum embedding magnitude to accept.
     * @param magnitude Value between 0.0 and 2.0 (default 0.5)
     */
    public setMinEmbeddingMagnitude(magnitude: number): void {
        this.minEmbeddingMagnitude = Math.max(0, Math.min(2.0, magnitude));
        this.logCallback(`Min embedding magnitude set to ${this.minEmbeddingMagnitude.toFixed(3)}`);
    }

    /**
     * Set the rejection threshold explicitly.
     * @param value Threshold between 0.0 and 1.0
     */
    public setRejectionThreshold(value: number): void {
        this.rejectionThreshold = Math.max(0, Math.min(1.0, value));
        this.logCallback(`Rejection threshold set to ${this.rejectionThreshold.toFixed(2)}`);
    }

    /**
     * Check if an embedding vector is valid (not silence/noise).
     * L2-normalized ECAPA embeddings should have magnitude ≈ 1.0
     */
    private isValidEmbedding(vector: number[]): boolean {
        if (!vector || vector.length === 0) return false;

        let magnitude = 0;
        for (let i = 0; i < vector.length; i++) {
            magnitude += vector[i] * vector[i];
        }
        magnitude = Math.sqrt(magnitude);

        if (magnitude < this.minEmbeddingMagnitude) {
            this.logCallback(`Embedding rejected: magnitude ${magnitude.toFixed(3)} < ${this.minEmbeddingMagnitude}`);
            return false;
        }
        return true;
    }

    /**
     * Identify which speaker a voice embedding belongs to.
     * Creates new speaker if no match found above threshold.
     * @param vector Speaker embedding vector (128-d from Vosk, 192/512-d from ECAPA)
     * @returns Speaker ID (0-indexed)
     */
    public identifySpeaker(vector: number[]): number {
        // Validate embedding quality
        if (!this.isValidEmbedding(vector)) {
            this.logCallback('Invalid/low-quality embedding, returning last speaker');
            return this.lastSpeakerId;
        }

        const now = Date.now();

        // If user is enrolled but speakers array is empty, fix it
        if (this.hasUserEnrolled && this.speakers.length === 0 && this.userProfile) {
            this.speakers.push([...this.userProfile]);
        }

        // Find best matching speaker and compute all scores
        let bestMatchIndex = -1;
        let bestScore = -1.0;
        let secondBestScore = -1.0;
        this.lastSimilarityScores = [];

        for (let i = 0; i < this.speakers.length; i++) {
            const score = this.cosineSimilarity(vector, this.speakers[i]);
            this.lastSimilarityScores.push({ speakerId: i, score });

            if (score > bestScore) {
                secondBestScore = bestScore;
                bestScore = score;
                bestMatchIndex = i;
            } else if (score > secondBestScore) {
                secondBestScore = score;
            }
        }

        // Calculate score margin (helps with confidence)
        const scoreMargin = bestScore - secondBestScore;

        this.logCallback(
            `Matching: best=${bestMatchIndex} (${bestScore.toFixed(3)}), ` +
            `2nd=${secondBestScore.toFixed(3)}, margin=${scoreMargin.toFixed(3)}, ` +
            `threshold=${this.threshold}, speakers=${this.speakers.length}`
        );

        // Decision logic with rejection threshold
        if (bestScore >= this.threshold && bestMatchIndex !== -1) {
            // Strong match found
            this.updateSpeakerProfile(bestMatchIndex, vector);

            // Temporal smoothing check
            if (bestMatchIndex !== this.lastSpeakerId) {
                const timeSinceSwitch = now - this.lastSwitchTime;

                // EXCEPTION: If score is very high (>0.88) or margin is clear (>0.15), allow immediate switch
                const canOverrideTemporal = bestScore > 0.88 || scoreMargin > 0.15;

                if (timeSinceSwitch < this.minTimeBetweenSwitches && !canOverrideTemporal) {
                    this.logCallback(`Temporal block (${timeSinceSwitch}ms), keeping speaker ${this.lastSpeakerId}`);
                    return this.lastSpeakerId;
                }

                this.logCallback(`Switching to speaker ${bestMatchIndex} (score: ${bestScore.toFixed(3)})`);
                this.lastSpeakerId = bestMatchIndex;
                this.lastSwitchTime = now;
            }

            return bestMatchIndex;

        } else if (bestScore < this.rejectionThreshold || this.speakers.length === 0) {
            // Definitely a new speaker (score too low or no speakers yet)
            return this.createNewSpeaker(vector, bestScore, now);

        } else {
            // In the "grey zone" between rejection and match threshold
            // Be conservative: create new speaker only if score is well below threshold
            const greyZoneMiddle = (this.threshold + this.rejectionThreshold) / 2;

            if (bestScore < greyZoneMiddle) {
                // Lean toward new speaker
                return this.createNewSpeaker(vector, bestScore, now);
            } else {
                // Lean toward last speaker to reduce spurious switches
                this.logCallback(`Grey zone (${bestScore.toFixed(3)}), keeping last speaker ${this.lastSpeakerId}`);
                return this.lastSpeakerId;
            }
        }
    }

    /**
     * Update a speaker profile with the new embedding.
     * NEVER adapts Speaker 0 (user profile) to prevent drift.
     */
    private updateSpeakerProfile(speakerId: number, vector: number[]): void {
        // CRITICAL: Do NOT adapt Speaker 0 (enrolled user) to prevent drift
        if (speakerId === 0 && this.hasUserEnrolled) {
            this.logCallback('Skipping adaptation for Speaker 0 (protected user profile)');
            return;
        }

        const currentVector = this.speakers[speakerId];
        if (!currentVector || currentVector.length !== vector.length) return;

        for (let i = 0; i < currentVector.length; i++) {
            currentVector[i] = currentVector[i] * (1 - this.adaptationRate) +
                vector[i] * this.adaptationRate;
        }
    }

    /**
     * Create a new speaker from an embedding.
     */
    private createNewSpeaker(vector: number[], bestScore: number, now: number): number {
        this.speakers.push([...vector]);
        const newSpeakerId = this.speakers.length - 1;
        this.logCallback(`New speaker detected: ${newSpeakerId} (best score: ${bestScore.toFixed(3)} < ${this.threshold})`);

        this.lastSpeakerId = newSpeakerId;
        this.lastSwitchTime = now;
        return newSpeakerId;
    }

    /**
     * Calculate cosine similarity between two vectors.
     * Returns 1.0 for identical vectors, 0.0 for orthogonal, -1.0 for opposite.
     */
    private cosineSimilarity(vec1: number[], vec2: number[]): number {
        if (vec1.length !== vec2.length) {
            this.logCallback(`Vector length mismatch: ${vec1.length} vs ${vec2.length}`);
            return 0;
        }

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
     * Get the number of detected speakers.
     */
    public getSpeakerCount(): number {
        return this.speakers.length;
    }

    /**
     * Get the last computed similarity scores for debugging.
     */
    public getLastSimilarityScores(): { speakerId: number; score: number }[] {
        return this.lastSimilarityScores;
    }

    /**
     * Clear all speaker profiles and reset state.
     * RESTORES User Profile if enrolled.
     */
    public clear(): void {
        this.speakers = [];
        this.lastSpeakerId = 0;
        this.lastSwitchTime = 0;
        this.sessionEmbeddings = [];
        this.lastSimilarityScores = [];

        // Restore user profile as Speaker 0 immediately
        if (this.hasUserEnrolled && this.userProfile) {
            this.speakers.push([...this.userProfile]);
            this.logCallback('Speaker profiles cleared (User profile restored as Spk 0)');
        } else {
            this.logCallback('Speaker profiles cleared');
        }
    }

    /**
     * Store an embedding in the session buffer for later offline clustering.
     */
    public storeEmbedding(id: string, embedding: number[], timestamp: number, speakerId: number): void {
        this.sessionEmbeddings.push({ id, embedding: [...embedding], timestamp, speakerId });
    }

    /**
     * Get all stored session embeddings for offline clustering.
     */
    public getSessionEmbeddings(): Array<{ id: string; embedding: number[]; timestamp: number; speakerId: number }> {
        return this.sessionEmbeddings;
    }

    /**
     * Clear session embeddings without clearing speaker profiles.
     */
    public clearSession(): void {
        this.sessionEmbeddings = [];
        this.logCallback('Session embeddings cleared');
    }

    /**
     * Get current threshold value.
     */
    public getThreshold(): number {
        return this.threshold;
    }

    /**
     * Get current rejection threshold value.
     */
    public getRejectionThreshold(): number {
        return this.rejectionThreshold;
    }

    /**
     * Get current speaker centroids for external use.
     */
    public getCentroids(): number[][] {
        return this.speakers.map(s => [...s]);
    }

    /**
     * Periodic re-clustering of session embeddings to refine speaker centroids.
     * Uses IncrementalStrategy for fast online clustering.
     * Returns a map of segmentId → corrected speakerId for transcript updates.
     *
     * Call this every ~30s during real-time recording to bring
     * post-processing quality into real-time mode.
     */
    public periodicRecluster(): Map<string, number> | null {
        if (this.sessionEmbeddings.length < 3) {
            this.logCallback(`Recluster skipped: only ${this.sessionEmbeddings.length} embeddings`);
            return null;
        }

        this.logCallback(`Periodic recluster: ${this.sessionEmbeddings.length} embeddings`);

        try {
            const strategy = new IncrementalStrategy();
            const stored: StoredEmbedding[] = this.sessionEmbeddings.map(e => ({
                id: e.id,
                embedding: e.embedding,
                timestamp: e.timestamp,
                originalSpeakerId: e.speakerId
            }));

            const result = strategy.cluster(stored, {
                distanceThreshold: 1 - this.threshold, // Convert similarity to distance
                logCallback: this.logCallback
            });

            // Update internal centroids with clustering results
            if (result.centroids.length > 0) {
                // Preserve user profile at index 0 if enrolled
                // Preserve user profile at index 0 if enrolled
                const newSpeakers: number[][] = [];

                if (this.hasUserEnrolled && this.userProfile) {
                    newSpeakers.push([...this.userProfile]);
                }

                for (const centroid of result.centroids) {
                    if (centroid.length > 0) {
                        newSpeakers.push([...centroid]);
                    }
                }

                // Only replace if clustering found a reasonable number of speakers
                if (newSpeakers.length > 0 && newSpeakers.length <= this.sessionEmbeddings.length) {
                    this.speakers = newSpeakers;
                    this.logCallback(`Centroids updated: ${this.speakers.length} speakers (was ${result.speakerCount})`);
                }
            }

            // Build correction map: segmentId → new speakerId
            const corrections = new Map<string, number>();
            for (const [embId, clusterId] of result.speakerAssignments) {
                // Offset by 1 if user profile is at index 0
                const offset = (this.hasUserEnrolled && this.userProfile) ? 1 : 0;
                corrections.set(embId, clusterId + offset);
            }

            return corrections;

        } catch (e) {
            this.logCallback(`Recluster failed: ${e}`);
            return null;
        }
    }
}
