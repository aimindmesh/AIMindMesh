import { useEffect, useRef } from 'react';
import { Vosk } from 'vosk-capacitor';
import { PluginListenerHandle } from '@capacitor/core';
import { SpeakerEmbedding as SpeakerEmbeddingPlugin } from 'speaker-embedding-capacitor';
import { logger } from '../../services/logger';
import { MeetingRecordingState } from './useMeetingRecording';
import { MeetingReprocessingState } from './useMeetingReprocessing';
import { SpeakerDiarization } from '../../services/speaker/speakerDiarization';
import { TranscriptSegment } from '../../types/meeting';
import { MeetingSettingsState } from './useMeetingSettings';
import { downsampleBuffer, floatToInt16, arrayBufferToBase64 } from '../../services/audio/audioUtils';

interface UseVoskTranscriptionProps {
    settings: MeetingSettingsState;
    recording: MeetingRecordingState;
    reprocessing: MeetingReprocessingState;
    diarizationRef: React.MutableRefObject<SpeakerDiarization>;
    setCurrentText: (text: string) => void;
    setTranscript: React.Dispatch<React.SetStateAction<TranscriptSegment[]>>;
}

export function useVoskTranscription({
    settings,
    recording,
    reprocessing,
    diarizationRef,
    setCurrentText,
    setTranscript
}: UseVoskTranscriptionProps) {

    // Periodic mini-clustering tracking refs
    const lastReclusterTime = useRef<number>(0);
    const lastReclusterSegCount = useRef<number>(0);

    useEffect(() => {
        let levelListener: PluginListenerHandle;
        let partialListener: PluginListenerHandle;
        let finalListener: PluginListenerHandle;

        const initListeners = async () => {
            // Always listen to audio level if recording, regardless of transcription mode
            levelListener = await Vosk.addListener('audioLevel', (data: any) => {
                if (recording.isRecording && !recording.isPaused) {
                    recording.setAudioLevel(data.level);
                    diarizationRef.current.recordRmsValue(data.level);
                }
            });

            // Only attach transcription listeners if Vosk mode is active
            if (settings.transcriptionMode === 'vosk') {
                partialListener = await Vosk.addListener('partialResult', (data: any) => {
                    if (data.text) {
                        setCurrentText(data.text);
                        diarizationRef.current.identifySpeaker();
                    }
                });

                finalListener = await Vosk.addListener('finalResult', async (data: { text: string; speakerVector?: number[], startMs?: number, endMs?: number }) => {
                    if (data.text && data.text.length > 0) {
                        logger.log('info', `[Vosk] Final result: "${data.text}", start: ${data.startMs}, end: ${data.endMs}`);
                        let embedding = data.speakerVector;

                        // ONNX embedding extraction for precise mode
                        if (settings.recognitionModeRef.current === 'precise') {
                            try {
                                // MINIMUM 2.0 seconds for reliable ECAPA embeddings
                                const MIN_DURATION = 2.0;
                                const targetDuration = Math.max(MIN_DURATION, settings.embeddingDurationRef.current);
                                let base64Audio: string | null = null;
                                let segmentRms = 0;

                                if (reprocessing.reprocessingStateRef.current.isReprocessing && reprocessing.reprocessingStateRef.current.audioData) {
                                    const fullData = reprocessing.reprocessingStateRef.current.audioData;
                                    const currentOffset = reprocessing.reprocessingStateRef.current.currentOffset;
                                    const sampleRate = 16000;
                                    const samplesNeeded = Math.ceil(targetDuration * sampleRate);
                                    const start = Math.max(0, currentOffset - samplesNeeded);
                                    const end = currentOffset;

                                    if (end > start) {
                                        const segment = fullData.slice(start, end);

                                        // Calculate RMS to validate voice activity
                                        let sumSq = 0;
                                        for (let i = 0; i < segment.length; i++) {
                                            sumSq += segment[i] * segment[i];
                                        }
                                        segmentRms = Math.sqrt(sumSq / segment.length);

                                        const int16 = floatToInt16(segment);
                                        base64Audio = arrayBufferToBase64(int16.buffer as ArrayBuffer);
                                    }
                                } else if (recording.audioContextRef.current) {
                                    const sampleRate = recording.audioContextRef.current.sampleRate;
                                    let totalSamples = 0;
                                    recording.audioBufferRef.current.forEach(c => totalSamples += c.length);

                                    if (totalSamples > 0) {
                                        const flattened = new Float32Array(totalSamples);
                                        let offset = 0;
                                        recording.audioBufferRef.current.forEach(c => {
                                            flattened.set(c, offset);
                                            offset += c.length;
                                        });

                                        const samplesToTake = Math.min(totalSamples, Math.ceil(targetDuration * sampleRate));
                                        const rawSegment = flattened.slice(totalSamples - samplesToTake);

                                        // Calculate RMS to validate voice activity
                                        let sumSq = 0;
                                        for (let i = 0; i < rawSegment.length; i++) {
                                            sumSq += rawSegment[i] * rawSegment[i];
                                        }
                                        segmentRms = Math.sqrt(sumSq / rawSegment.length);

                                        const downsampled = downsampleBuffer(rawSegment, sampleRate, 16000);
                                        const int16 = floatToInt16(downsampled);
                                        base64Audio = arrayBufferToBase64(int16.buffer as ArrayBuffer);
                                    }
                                }

                                // Only extract embedding if audio has sufficient voice activity
                                const MIN_RMS = 0.01;
                                if (base64Audio && segmentRms >= MIN_RMS) {
                                    const result = await SpeakerEmbeddingPlugin.extractEmbedding({ audioData: base64Audio });
                                    if (result && result.embedding) {
                                        embedding = result.embedding;
                                        logger.log('info', `ONNX Embedding extracted (RMS: ${segmentRms.toFixed(4)})`);
                                    }
                                } else if (base64Audio && segmentRms < MIN_RMS) {
                                    logger.log('warn', `Skipping ONNX extraction: RMS ${segmentRms.toFixed(4)} < ${MIN_RMS} (silence/noise)`);
                                }
                            } catch (e) {
                                logger.log('warn', 'ONNX extraction failed', e);
                            }
                        }

                        const speakerId = diarizationRef.current.identifySpeaker(embedding);
                        const segmentId = Date.now().toString();

                        if (embedding && embedding.length > 0) {
                            diarizationRef.current.getEmbeddingService().storeEmbedding(
                                segmentId, embedding, Date.now(), speakerId
                            );
                        }

                        setTranscript(prev => {
                            const updated = [...prev, {
                                id: segmentId,
                                speakerId,
                                text: data.text,
                                timestamp: Date.now(),
                                start_ms: data.startMs,
                                end_ms: data.endMs
                            }];

                            // --- Periodic Mini-Clustering ---
                            // Every 30s or 10 segments, re-cluster to refine centroids
                            const now = Date.now();
                            const segsSinceRecluster = updated.length - lastReclusterSegCount.current;
                            const timeSinceRecluster = now - lastReclusterTime.current;
                            const RECLUSTER_INTERVAL_MS = 30000;
                            const RECLUSTER_MIN_SEGMENTS = 10;

                            if (segsSinceRecluster >= RECLUSTER_MIN_SEGMENTS &&
                                timeSinceRecluster >= RECLUSTER_INTERVAL_MS) {
                                try {
                                    const corrections = diarizationRef.current
                                        .getEmbeddingService().periodicRecluster();
                                    if (corrections && corrections.size > 0) {
                                        // Apply corrections to transcript
                                        let correctedCount = 0;
                                        const corrected = updated.map(seg => {
                                            const newId = corrections.get(seg.id);
                                            if (newId !== undefined && newId !== seg.speakerId) {
                                                correctedCount++;
                                                return { ...seg, speakerId: newId };
                                            }
                                            return seg;
                                        });
                                        if (correctedCount > 0) {
                                            logger.log('info',
                                                `Mini-clustering corrected ${correctedCount} segments`);
                                        }
                                        lastReclusterTime.current = now;
                                        lastReclusterSegCount.current = corrected.length;
                                        return corrected;
                                    }
                                } catch (e) {
                                    logger.log('warn', 'Periodic recluster failed', e);
                                }
                                lastReclusterTime.current = now;
                                lastReclusterSegCount.current = updated.length;
                            }

                            return updated;
                        });
                        setCurrentText('');
                    }
                });
            }
        };

        initListeners();

        return () => {
            if (levelListener) levelListener.remove();
            if (partialListener) partialListener.remove();
            if (finalListener) finalListener.remove();
            // Don't stop recording here, it's handled by useMeetingRecording
            if (settings.transcriptionMode === 'vosk') {
                Vosk.stopRecognition().catch(console.warn);
            }
        };
    }, [settings.transcriptionMode]); // Re-run when mode changes
}
