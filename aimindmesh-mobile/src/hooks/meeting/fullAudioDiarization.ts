import { SpeakerEmbedding as SpeakerEmbeddingPlugin } from 'speaker-embedding-capacitor';
import { TranscriptSegment } from '../../types/meeting';
import { SpeechConfig } from '../../types';
import { logger } from '../../services/logger';
import { SpeakerClustering } from '../../services/speaker/speakerClustering';
import { assignSpeakersByTime, hasSegmentTiming, TimedEmbedding } from '../../services/speaker/segmentAssignment';
import { alignClusterLabels } from '../../services/speaker/labelAlignment';
import { floatToInt16, arrayBufferToBase64 } from '../../services/audio/audioUtils';
import { getVADService, SpeechSegment } from '../../services/stt/vadService';
import { openMeetingPcm } from './meetingPcmSource';

const SAMPLES_PER_MS = 16;
// TUNED FOR ECAPA-TDNN: longer windows = better embeddings
const WINDOW_MS = 2500;
const MIN_HOP_MS = 500;
/** Bounded window count: clustering and embedding time stay reasonable on long meetings */
const MAX_WINDOWS = 1200;

export interface FullDiarizationOptions {
    audioUrl: string | null;
    audioFilePath: string | null;
    transcript: TranscriptSegment[];
    speechConfig?: SpeechConfig;
    targetSpeakerCount?: number;
    similarityThreshold: number;
    showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
    setStatus: (status: string) => void;
    isCancelled: () => boolean;
}

/**
 * Two-pass diarization of the whole recording: speaker profiles from sliding windows, then each
 * segment matched by its position in the audio. Returns null when cancelled or impossible.
 */
export async function runFullAudioDiarization(opts: FullDiarizationOptions): Promise<TranscriptSegment[] | null> {
    const { transcript, showToast } = opts;
    if (!transcript.some(hasSegmentTiming)) {
        showToast('These segments have no timing: reprocess the audio first', 'info');
        return null;
    }

    opts.setStatus('Decoding audio...');
    const source = await openMeetingPcm(opts.audioUrl, opts.audioFilePath);
    const durationMs = source.totalSamples / SAMPLES_PER_MS;
    const hopMs = Math.max(MIN_HOP_MS, Math.ceil(durationMs / MAX_WINDOWS));

    // --- VAD / Silence Filtering ---
    let speechSegments: SpeechSegment[] | null = null;
    if (opts.speechConfig?.enableVAD === true && source.wavPath) {
        try {
            const vadService = getVADService();
            // Nothing else loads the VAD model: checking alone meant VAD never ran here
            if (await vadService.ensureModelLoaded(opts.speechConfig?.vadModelId)) {
                speechSegments = await vadService.processFile(source.wavPath);
                if (speechSegments.length > 0) {
                    speechSegments = vadService.mergeSegments(speechSegments, 500);
                    showToast(`VAD: ${speechSegments.length} speech regions found`, 'info');
                }
            }
        } catch (vadErr) {
            logger.log('warn', 'VAD processing failed, using RMS energy filter', vadErr);
        }
    }

    const windows: TimedEmbedding[] = [];
    let skippedWindows = 0;
    const totalWindows = Math.max(1, Math.floor((durationMs - WINDOW_MS) / hopMs) + 1);
    for (let startMs = 0, index = 0; startMs + WINDOW_MS <= durationMs; startMs += hopMs, index++) {
        if (opts.isCancelled()) return null;
        const endMs = startMs + WINDOW_MS;
        if (index % 20 === 0) opts.setStatus(`Speaker analysis: ${Math.round((index / totalWindows) * 100)}%`);

        if (speechSegments && speechSegments.length > 0) {
            if (!speechSegments.some(seg => startMs < seg.endMs && endMs > seg.startMs)) {
                skippedWindows++;
                continue;
            }
        }

        const samples = await source.read(Math.round(startMs * SAMPLES_PER_MS), WINDOW_MS * SAMPLES_PER_MS);
        if (!speechSegments || speechSegments.length === 0) {
            let sumSq = 0;
            for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
            if (samples.length === 0 || Math.sqrt(sumSq / samples.length) < 0.01) {
                skippedWindows++;
                continue;
            }
        }

        try {
            const base64Audio = arrayBufferToBase64(floatToInt16(samples).buffer as ArrayBuffer);
            const result = await SpeakerEmbeddingPlugin.extractEmbedding({ audioData: base64Audio });
            if (result?.embedding?.length > 0) windows.push({ startMs, endMs, embedding: result.embedding });
        } catch (e) {
            // Skip failed extraction
        }
    }
    if (skippedWindows > 0) logger.log('info', `Skipped ${skippedWindows} silence/noise windows`);

    if (windows.length < 2) {
        showToast('Too few embeddings extracted', 'error');
        return null;
    }

    // PASS 1: speaker profiles (centroids) valid for the whole meeting
    opts.setStatus('Clustering speakers...');
    const clustering = new SpeakerClustering((msg) => logger.log('debug', 'FullDiarization', msg));
    const clusterResult = clustering.cluster(
        windows.map((w, i) => ({ id: `grid_${i}`, embedding: w.embedding, timestamp: w.startMs, originalSpeakerId: 0 })),
        { targetSpeakers: opts.targetSpeakerCount, distanceThreshold: 1 - opts.similarityThreshold }
    );
    showToast(`Pass 1: Profiles created for ${clusterResult.speakerCount} speakers`, 'info');

    // PASS 2: every timed segment to the profile nearest to the audio it covers
    const assigned = assignSpeakersByTime(transcript, windows, clusterResult.centroids,
        (embedding, centroids) => clustering.findNearestSpeaker(embedding, centroids));

    // Keep the existing ids (and the names given to them) where the new clusters match them
    const timed = transcript.map(hasSegmentTiming);
    const pairs: Array<{ previous: number; cluster: number }> = [];
    assigned.forEach((seg, i) => {
        if (timed[i]) pairs.push({ previous: transcript[i].speakerId, cluster: seg.speakerId });
    });
    const maxSpeakerId = transcript.reduce((max, s) => Math.max(max, s.speakerId), 0);
    const labels = alignClusterLabels(pairs, maxSpeakerId + 1);
    const relabeled = assigned.map((seg, i) => timed[i] ? { ...seg, speakerId: labels.get(seg.speakerId) ?? seg.speakerId } : seg);

    // PASS 3: Temporal Smoothing
    const { applyTemporalSmoothing } = await import('../../services/speaker/diarizationSmoothing');
    return applyTemporalSmoothing(relabeled, opts.speechConfig?.diarizationSmoothingAlgorithm || 'median');
}
