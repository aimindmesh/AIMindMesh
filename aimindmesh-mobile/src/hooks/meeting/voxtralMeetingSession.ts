import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import { SpeakerEmbedding as SpeakerEmbeddingPlugin } from 'speaker-embedding-capacitor';
import { logger } from '../../services/logger';
import { RecognitionMode, TranscriptSegment } from '../../types/meeting';
import { floatToInt16, arrayBufferToBase64 } from '../../services/audio/audioUtils';
import { applyVoxtralUpdate, initialVoxtralCursor, skipVoxtralText } from '../../services/meeting/voxtralSegments';
import { newSegmentId } from '../../services/meeting/meetingIds';

interface VoxtralMeetingDeps {
    setTranscript?: Dispatch<SetStateAction<TranscriptSegment[]>>;
    diarizationRef?: MutableRefObject<any>;
    recognitionModeRef: MutableRefObject<RecognitionMode>;
    isPausedRef: MutableRefObject<boolean>;
    /** Recorded audio between two recording positions (ms), for live speaker embeddings */
    getAudioRange: (startMs: number, endMs: number) => Promise<Float32Array | null>;
    onLagging?: (message: string) => void;
}

type TokenLike = { text?: string } & Record<string, unknown>;

/** Token time in ms, whatever the field is called by the plugin version in use */
function tokenMs(token: TokenLike | undefined, keys: string[]): number | undefined {
    if (!token) return undefined;
    for (const key of keys) {
        const value = token[key];
        if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return undefined;
}

async function voxtralService() {
    const { getVoxtralSttService } = await import('../../services/stt/voxtralSTT');
    return getVoxtralSttService();
}

/** Window of speech used for a live speaker embedding */
const EMBEDDING_WINDOW_MS = 4000;
/** At most one embedding every 3 seconds, to leave the CPU to Voxtral */
const EMBEDDING_INTERVAL_MS = 3000;

let laggingHandle: Promise<PluginListenerHandle> | null = null;

/**
 * Starts Voxtral on the meeting recorder's audio (no second microphone): token times are positions
 * in the recording. Updates are processed in arrival order (an awaited embedding must not let an
 * older, shorter transcript overwrite a newer one) and each segment keeps only its own slice of
 * Voxtral's accumulated text.
 */
export async function startVoxtralMeeting(deps: VoxtralMeetingDeps): Promise<void> {
    let cursor = initialVoxtralCursor();
    let queue: Promise<void> = Promise.resolve();
    let segmentsSinceRecluster = 0;
    let lastEmbedTime = 0;

    const handle = async (accumulated: string, tokens: TokenLike[]) => {
        if (!deps.setTranscript || !tokens || tokens.length === 0) return;
        if (deps.isPausedRef.current) {
            cursor = skipVoxtralText(accumulated);
            return;
        }

        const startMs = tokenMs(tokens[0], ['startMs', 'start_ms']) ?? 0;
        const endMs = Math.max(startMs, tokenMs(tokens[tokens.length - 1], ['endMs', 'end_ms']) ?? startMs);

        const diarization = deps.diarizationRef?.current;
        let speakerId: number = diarization?.identifySpeaker() ?? 0;
        const isPrecise = deps.recognitionModeRef.current === 'precise';

        if (isPrecise && diarization && Date.now() - lastEmbedTime > EMBEDDING_INTERVAL_MS) {
            try {
                const audio = await deps.getAudioRange(Math.max(0, endMs - EMBEDDING_WINDOW_MS), endMs);
                if (audio && audio.length > 0) {
                    const base64Audio = arrayBufferToBase64(floatToInt16(audio).buffer as ArrayBuffer);
                    const embedResult = await SpeakerEmbeddingPlugin.extractEmbedding({ audioData: base64Audio });
                    if (embedResult?.embedding?.length > 0) {
                        speakerId = diarization.identifySpeaker(embedResult.embedding);
                        diarization.getEmbeddingService().storeEmbedding(
                            `voxtral_embed_${Date.now()}`, embedResult.embedding, Date.now(), speakerId
                        );
                        segmentsSinceRecluster++;
                        lastEmbedTime = Date.now();
                    }
                }
            } catch (e) {
                // ONNX extraction failed, use fallback speakerId
            }
        }

        const newText = tokens.map(t => (typeof t.text === 'string' ? t.text : '')).join('');
        deps.setTranscript(prev => {
            const result = applyVoxtralUpdate(
                prev, cursor, accumulated, newText, speakerId,
                { startMs, endMs },
                () => newSegmentId('voxtral'), Date.now()
            );
            cursor = result.cursor;
            return result.segments;
        });

        // Periodic re-clustering every ~10 embedded updates
        if (isPrecise && segmentsSinceRecluster >= 10) {
            try {
                diarization?.getEmbeddingService().periodicRecluster();
                segmentsSinceRecluster = 0;
            } catch (e) {
                logger.log('warn', 'Voxtral periodic recluster failed', e);
            }
        }
    };

    const { default: Voxtral } = await import('../../services/stt/voxtralPlugin');
    laggingHandle = Voxtral.addListener('voxtralLagging', ({ message }) => deps.onLagging?.(message));

    const service = await voxtralService();
    try {
        await service.start((accumulated: string, tokens: any[]) => {
            queue = queue
                .then(() => handle(accumulated, tokens as TokenLike[]))
                .catch(e => logger.log('warn', 'Voxtral update failed', e));
        }, undefined, { externalAudio: true });
    } catch (e) {
        void laggingHandle.then(h => h.remove()).catch(() => { });
        laggingHandle = null;
        throw e;
    }
}

/** Stops Voxtral after it has transcribed the audio already recorded (the last words). */
export async function stopVoxtralMeeting(): Promise<void> {
    try {
        const service = await voxtralService();
        await service.stop();
        logger.log('info', 'Voxtral STT stopped');
    } catch (e) {
        logger.log('warn', 'Error stopping Voxtral', e);
    } finally {
        void laggingHandle?.then(h => h.remove()).catch(() => { });
        laggingHandle = null;
    }
}
