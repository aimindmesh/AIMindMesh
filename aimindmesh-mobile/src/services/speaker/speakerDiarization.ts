import { logger } from '../logger';
import { SpeakerEmbedding } from '../speaker/speakerEmbedding';

interface SpeakerProfile {
    avgRms: number;
    rmsVariance: number;
    speechRate: number;
    sampleCount: number;
    rmsHistory: number[];
}

export class SpeakerDiarization {
    private speakers: SpeakerProfile[] = [];
    private currentRmsValues: number[] = [];

    // Embedding-based identification (PRIMARY method when available)
    private embeddingService = new SpeakerEmbedding();

    // Temporal continuity tracking (for RMS fallback)
    private lastSpeakerId: number = 0;
    private segmentsSinceChange: number = 0;
    private readonly MIN_SEGMENTS_BEFORE_SWITCH = 3; // Increased from 2 for better stability

    // Threshold for considering two speakers different (higher = more tolerant)
    // Optimized from 0.45 to 0.55 to reduce spurious speakers
    private _similarityThreshold = 0.55;

    // Minimum RMS samples needed before attempting identification
    private readonly minSamplesForIdentification = 20;

    constructor(private logCallback: (msg: string) => void = (msg) => logger.log('debug', 'Diarization', msg)) {
        // Configure embedding service to use same log callback
        this.embeddingService = new SpeakerEmbedding(this.logCallback);
    }

    /**
     * Get access to the embedding service for session embedding storage.
     */
    public getEmbeddingService(): SpeakerEmbedding {
        return this.embeddingService;
    }


    // Getter and setter for configurable threshold
    public get similarityThreshold(): number {
        return this._similarityThreshold;
    }

    public setSimilarityThreshold(value: number): void {
        this._similarityThreshold = Math.max(0.3, Math.min(0.8, value));
        // Convert sensitivity to embedding threshold (tuned for ECAPA-TDNN):
        // High sensitivity (0.8) → high threshold (0.90) = harder to match = more speakers
        // Low sensitivity (0.3) → low threshold (0.70) = easier to match = fewer speakers
        // Range: 0.70 + (value - 0.3) * 0.4 => 0.70 to 0.90
        const embeddingThreshold = 0.70 + (value - 0.3) * 0.4;
        this.embeddingService.setThreshold(embeddingThreshold);
        this.logCallback(`Sensitivity: ${this._similarityThreshold.toFixed(2)}, embedding threshold: ${embeddingThreshold.toFixed(2)}`);
    }

    /**
     * Set minimum time between speaker switches for embedding-based identification.
     * @param ms Time in milliseconds (0-10000)
     */
    public setMinTimeBetweenSwitches(ms: number): void {
        this.embeddingService.setMinTimeBetweenSwitches(ms);
    }

    public setAdaptationRate(rate: number): void {
        this.embeddingService.setAdaptationRate(rate);
    }

    public setMinEmbeddingMagnitude(magnitude: number): void {
        this.embeddingService.setMinEmbeddingMagnitude(magnitude);
    }

    public setRejectionThreshold(value: number): void {
        this.embeddingService.setRejectionThreshold(value);
    }

    public setEmbeddingThreshold(value: number): void {
        this.embeddingService.setThreshold(value);
    }

    public recordRmsValue(rmsdB: number): void {
        // RmsdB is typically in range [-2, 10] (normalized 0-1 from plugin)
        // The plugin sends normalized values (0.0 - 1.0), so we use them directly or adjust if needed.
        // In Kotlin code: val normalized = ((rmsdB + 2) / 12f).coerceIn(0f, 1f)
        // But VoskPlugin.java sends: float normalizedLevel = Math.min(rms / 32768.0f, 1.0f);
        // Wait, VoskPlugin.java sends normalized amplitude (0-1).
        // The Kotlin SimpleSpeakerDiarization expected dB-like values or normalized values?
        // Kotlin: recordRmsValue(rmsdB: Float) -> normalized = ((rmsdB + 2) / 12f)
        // But VoskAudioRecorder.kt sent: normalized = (rms / 10000.0).coerceIn(0.0, 1.0)
        // It seems the input here should be the normalized amplitude.

        const normalized = Math.max(0, Math.min(1, rmsdB));

        // Only record values above noise threshold (increased from 0.08 to 0.12)
        if (normalized > 0.12) {
            this.currentRmsValues.push(normalized);
        }

        // Keep only recent values (last 2 seconds worth at ~100Hz)
        if (this.currentRmsValues.length > 200) {
            this.currentRmsValues.shift();
        }
    }

    /**
     * Identify speaker using embedding vector (PRIMARY) or RMS analysis (FALLBACK).
     * @param embedding Optional speaker embedding vector from Vosk or ONNX
     * @returns Speaker ID (0-indexed)
     */
    public identifySpeaker(embedding?: number[]): number {
        // PRIMARY: Use embedding-based identification when available
        if (embedding && embedding.length > 0) {
            return this.embeddingService.identifySpeaker(embedding);
        }

        // FALLBACK: RMS-based identification (less accurate)
        // this.logCallback('No embedding available, using RMS-based fallback');
        return this.identifySpeakerByRms();
    }

    /**
     * RMS-based speaker identification (fallback when embeddings not available)
     * @private
     */
    private identifySpeakerByRms(): number {
        // Need minimum samples for reliable identification
        if (this.currentRmsValues.length < this.minSamplesForIdentification) {
            // this.logCallback(`Not enough RMS data (${this.currentRmsValues.length} < ${this.minSamplesForIdentification}), using speaker ${this.lastSpeakerId}`);
            this.currentRmsValues = [];

            // If we have at least one speaker, use last speaker
            if (this.speakers.length === 0) {
                // Create first speaker with minimal data
                this.speakers.push({
                    avgRms: 0,
                    rmsVariance: 0,
                    speechRate: 0,
                    sampleCount: 1,
                    rmsHistory: []
                });
            }
            this.segmentsSinceChange++;
            return this.lastSpeakerId;
        }

        // Calculate characteristics from recent RMS values
        const avgRms = this.calculateAverage(this.currentRmsValues);
        const variance = this.calculateVariance(this.currentRmsValues);
        const speechRate = this.estimateSpeechRate(this.currentRmsValues);

        this.logCallback(`Audio features: avgRms=${avgRms.toFixed(3)}, variance=${variance.toFixed(3)}, speechRate=${speechRate.toFixed(3)}, samples=${this.currentRmsValues.length}, lastSpeaker=${this.lastSpeakerId}, segments since change=${this.segmentsSinceChange}`);

        // Find best matching speaker
        let bestMatch = -1;
        let bestScore = Number.MAX_VALUE;

        this.speakers.forEach((profile, index) => {
            // Calculate similarity score (lower is better)
            // Optimized weights: variance more important for distinguishing voice timbre
            const rmsScore = Math.abs(avgRms - profile.avgRms) * 1.5;  // Reduced from 2.0
            const varianceScore = Math.abs(variance - profile.rmsVariance) * 2.0;  // Increased from 1.5
            const rateScore = Math.abs(speechRate - profile.speechRate) * 0.8;  // Increased from 0.5

            let totalScore = rmsScore + varianceScore + rateScore;

            // TEMPORAL BONUS: Moderate preference for last speaker
            if (index === this.lastSpeakerId && this.segmentsSinceChange < this.MIN_SEGMENTS_BEFORE_SWITCH) {
                // Apply moderate bonus to keep same speaker (reduced from 0.7 to 0.75)
                totalScore *= 0.75;
                this.logCallback(`Speaker ${index} (LAST) similarity: ${totalScore.toFixed(3)} (with temporal bonus)`);
            } else {
                this.logCallback(`Speaker ${index} similarity: ${totalScore.toFixed(3)}`);
            }

            if (totalScore < bestScore) {
                bestScore = totalScore;
                bestMatch = index;
            }
        });

        // Decision logic
        let speakerId: number;

        if (bestScore < this.similarityThreshold && bestMatch !== -1) {
            // Match found
            const profile = this.speakers[bestMatch];
            this.updateProfile(profile, avgRms, variance, speechRate);

            if (bestMatch === this.lastSpeakerId) {
                this.segmentsSinceChange++;
                this.logCallback(`Matched to SAME speaker ${bestMatch} (score: ${bestScore.toFixed(3)})`);
                speakerId = bestMatch;
            } else {
                // Switching speakers
                if (this.segmentsSinceChange < this.MIN_SEGMENTS_BEFORE_SWITCH) {
                    // Too soon to switch, stay with last speaker unless score is significantly better
                    if (bestScore < this.similarityThreshold * 0.75) {  // Adjusted from 0.8 to 0.75
                        this.logCallback(`Switched to speaker ${bestMatch} despite short duration (high confidence)`);
                        this.lastSpeakerId = bestMatch;
                        this.segmentsSinceChange = 0;
                        speakerId = bestMatch;
                    } else {
                        this.logCallback(`Keeping last speaker ${this.lastSpeakerId} (waiting for stability)`);
                        speakerId = this.lastSpeakerId;
                        this.segmentsSinceChange++;
                    }
                } else {
                    this.logCallback(`Switched to NEW speaker ${bestMatch}`);
                    this.lastSpeakerId = bestMatch;
                    this.segmentsSinceChange = 0;
                    speakerId = bestMatch;
                }
            }
        } else {
            // Score too high - check if we should create new speaker
            if (bestScore > this.similarityThreshold * 1.3) {  // Increased from 1.2 to 1.3
                // New speaker
                const newProfile: SpeakerProfile = {
                    avgRms,
                    rmsVariance: variance,
                    speechRate,
                    sampleCount: 1,
                    rmsHistory: []
                };
                this.speakers.push(newProfile);
                const newSpeakerId = this.speakers.length - 1;
                this.logCallback(`New speaker detected: ${newSpeakerId} (score: ${bestScore.toFixed(3)})`);
                this.lastSpeakerId = newSpeakerId;
                this.segmentsSinceChange = 0;
                speakerId = newSpeakerId;
            } else {
                // In the "grey area" - stick with last speaker to avoid noise
                this.logCallback(`Score ${bestScore.toFixed(3)} in grey area - keeping last speaker ${this.lastSpeakerId}`);
                this.segmentsSinceChange++;
                speakerId = this.lastSpeakerId;
            }
        }

        // Clear current values for next speech segment
        this.currentRmsValues = [];

        return speakerId;
    }

    public clear(): void {
        this.speakers = [];
        this.currentRmsValues = [];
        this.lastSpeakerId = 0;
        this.segmentsSinceChange = 0;
        this.embeddingService.clear(); // Ensure embedding service is also cleared
        this.logCallback('Speaker profiles cleared, state reset');
    }

    public getSpeakerCount(): number {
        return this.speakers.length;
    }

    private updateProfile(profile: SpeakerProfile, avgRms: number, variance: number, speechRate: number): void {
        // Running average with more weight on existing profile for stability
        const alpha = 0.25;
        profile.avgRms = profile.avgRms * (1 - alpha) + avgRms * alpha;
        profile.rmsVariance = profile.rmsVariance * (1 - alpha) + variance * alpha;
        profile.speechRate = profile.speechRate * (1 - alpha) + speechRate * alpha;
        profile.sampleCount++;
    }

    private calculateAverage(values: number[]): number {
        if (values.length === 0) return 0;
        const sum = values.reduce((a, b) => a + b, 0);
        return sum / values.length;
    }

    private calculateVariance(values: number[]): number {
        if (values.length < 2) return 0;
        const mean = this.calculateAverage(values);
        const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
        const avgSquaredDiff = this.calculateAverage(squaredDiffs);
        return Math.sqrt(avgSquaredDiff);
    }

    private estimateSpeechRate(rmsValues: number[]): number {
        if (rmsValues.length < 10) return 0;

        // Count significant RMS changes (approximation of syllable rate)
        let changes = 0;
        const threshold = 0.10;  // Increased from 0.08 to 0.10

        for (let i = 1; i < rmsValues.length; i++) {
            if (Math.abs(rmsValues[i] - rmsValues[i - 1]) > threshold) {
                changes++;
            }
        }

        // Normalize by number of samples
        return changes / rmsValues.length;
    }
}
