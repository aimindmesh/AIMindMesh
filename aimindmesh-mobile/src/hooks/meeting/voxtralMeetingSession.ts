import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { SpeakerEmbedding as SpeakerEmbeddingPlugin } from 'speaker-embedding-capacitor';
import { logger } from '../../services/logger';
import { RecognitionMode, TranscriptSegment } from '../../types/meeting';
import { floatToInt16, arrayBufferToBase64 } from '../../services/audio/audioUtils';
import { MeetingTimeline } from '../../services/meeting/meetingTimeline';
import { applyVoxtralUpdate, initialVoxtralCursor, skipVoxtralText } from '../../services/meeting/voxtralSegments';
import { newSegmentId } from '../../services/meeting/meetingIds';

interface VoxtralMeetingDeps {
    setTranscript?: Dispatch<SetStateAction<TranscriptSegment[]>>;
    diarizationRef?: MutableRefObject<any>;
    recognitionModeRef: MutableRefObject<RecognitionMode>;
    audioBufferRef: MutableRefObject<Float32Array[]>;
    isPausedRef: MutableRefObject<boolean>;
    timelineRef: MutableRefObject<MeetingTimeline>;
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

/**
 * Starts Voxtral streaming into the meeting transcript. Updates are processed in arrival order
 * (an awaited embedding must not let an older, shorter transcript overwrite a newer one) and each
 * segment keeps only its own slice of Voxtral's accumulated text.
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

        const diarization = deps.diarizationRef?.current;
        let speakerId: number = diarization?.identifySpeaker() ?? 0;
        const isPrecise = deps.recognitionModeRef.current === 'precise';

        if (isPrecise && diarization && deps.audioBufferRef.current.length > 0) {
            const now = Date.now();
            // At most one embedding every 3 seconds to avoid overloading
            if (now - lastEmbedTime > 3000) {
                try {
                    const chunks = deps.audioBufferRef.current;
                    const flattened = new Float32Array(chunks.reduce((acc, c) => acc + c.length, 0));
                    let offset = 0;
                    chunks.forEach(c => { flattened.set(c, offset); offset += c.length; });
                    const samplesToTake = Math.min(flattened.length, Math.ceil(4.0 * 16000));
                    const rawSegment = flattened.slice(Math.max(0, flattened.length - samplesToTake));
                    const base64Audio = arrayBufferToBase64(floatToInt16(rawSegment).buffer as ArrayBuffer);
                    const embedResult = await SpeakerEmbeddingPlugin.extractEmbedding({ audioData: base64Audio });
                    if (embedResult?.embedding?.length > 0) {
                        speakerId = diarization.identifySpeaker(embedResult.embedding);
                        diarization.getEmbeddingService().storeEmbedding(
                            `voxtral_embed_${Date.now()}`, embedResult.embedding, Date.now(), speakerId
                        );
                        segmentsSinceRecluster++;
                        lastEmbedTime = now;
                    }
                } catch (e) {
                    // ONNX extraction failed, use fallback speakerId
                }
            }
        }

        const newText = tokens.map(t => (typeof t.text === 'string' ? t.text : '')).join('');
        const nowFileMs = deps.timelineRef.current.wallToFileMs(Date.now());
        const startMs = tokenMs(tokens[0], ['startMs', 'start_ms', 'timestampMs']) ?? nowFileMs;
        const endMs = tokenMs(tokens[tokens.length - 1], ['endMs', 'end_ms', 'timestampMs']) ?? nowFileMs;

        deps.setTranscript(prev => {
            const result = applyVoxtralUpdate(
                prev, cursor, accumulated, newText, speakerId,
                { startMs, endMs: Math.max(startMs, endMs) },
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

    const service = await voxtralService();
    await service.start((accumulated: string, tokens: any[]) => {
        queue = queue
            .then(() => handle(accumulated, tokens as TokenLike[]))
            .catch(e => logger.log('warn', 'Voxtral update failed', e));
    });
}

export async function stopVoxtralMeeting(): Promise<void> {
    try {
        const service = await voxtralService();
        await service.stop();
        logger.log('info', 'Voxtral STT stopped');
    } catch (e) {
        logger.log('warn', 'Error stopping Voxtral', e);
    }
}
