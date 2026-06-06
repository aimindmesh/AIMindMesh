import { useState, useRef, useCallback } from 'react';
import { Vosk } from 'vosk-capacitor';
import { SpeakerEmbedding as SpeakerEmbeddingPlugin } from 'speaker-embedding-capacitor';
// Filesystem import removed - no longer needed with live segment streaming
import { TranscriptSegment } from '../../types/meeting';
import { SpeechConfig } from '../../types';
import { logger } from '../../services/logger';
import { SpeakerClustering } from '../../services/speaker/speakerClustering';
import { downsampleBuffer, floatToInt16, arrayBufferToBase64 } from '../../services/audio/audioUtils';
import AudioConverter from '../../services/audio/audioConverter';
import { getWhisperSTTService } from '../../services/stt/whisperSTT';
import { Capacitor } from '@capacitor/core';
import { getVADService, SpeechSegment } from '../../services/stt/vadService';

interface UseMeetingReprocessingProps {
    playback: any;
    speechConfig?: SpeechConfig;
    transcript: TranscriptSegment[];
    setTranscript: React.Dispatch<React.SetStateAction<TranscriptSegment[]>>;
    diarizationRef: React.MutableRefObject<any>;
    settings: any;
    showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
    saveMeeting: () => Promise<void>;
    pcmAudioBlobRef: React.MutableRefObject<Blob | null>;
    audioFilePathRef: React.MutableRefObject<string | null>;
}

export interface MeetingReprocessingState {
    isReclustering: boolean;
    processingStatus: string;
    reprocessMeeting: () => Promise<void>;
    fullAudioDiarization: () => Promise<void>;
    reclusterSpeakers: () => Promise<void>;
    handleCancelProcessing: () => void;
    reprocessingStateRef: React.MutableRefObject<{
        audioData: Float32Array | null;
        currentOffset: number;
        isReprocessing: boolean;
    }>;
}

export const useMeetingReprocessing = ({
    playback,
    speechConfig,
    transcript,
    setTranscript,
    diarizationRef,
    settings,
    showToast,
    saveMeeting,
    pcmAudioBlobRef,
    audioFilePathRef
}: UseMeetingReprocessingProps) => {
    const [isReclustering, setIsReclustering] = useState(false);
    const [processingStatus, setProcessingStatus] = useState<string>('');

    const abortProcessingRef = useRef<boolean>(false);
    const reprocessingStateRef = useRef<{
        audioData: Float32Array | null;
        currentOffset: number;
        isReprocessing: boolean;
    }>({
        audioData: null,
        currentOffset: 0,
        isReprocessing: false
    });

    const handleCancelProcessing = useCallback(() => {
        abortProcessingRef.current = true;
        setProcessingStatus('Cancelling...');
    }, []);

    const reprocessMeeting = async () => {
        if (!playback.recordedAudioUrl) {
            showToast('No recorded audio to reprocess', 'error');
            return;
        }

        try {
            abortProcessingRef.current = false;
            const sttMode = speechConfig?.sttMode || 'vosk-only';
            const useWhisper = sttMode === 'whisper-post' || sttMode === 'hybrid';

            showToast(`Reprocessing in progress (${useWhisper ? 'Whisper' : 'Vosk'})...`, 'info');
            setIsReclustering(true);
            setProcessingStatus('Preparing audio...');
            setTranscript([]);
            diarizationRef.current.clear();

            if (abortProcessingRef.current) throw new Error('Operazione annullata');

            // 1. FILE BASED REPROCESSING (Best for memory)
            if (audioFilePathRef.current) {
                try {
                    setProcessingStatus('Decoding audio file...');
                    const decodeResult = await AudioConverter.decodeM4AToWav({ filePath: audioFilePathRef.current });
                    const wavPath = decodeResult.filePath;
                    logger.log('info', `Decoded M4A to WAV for reprocessing: ${wavPath}`);

                    if (useWhisper) {
                        const whisperService = getWhisperSTTService();

                        if (await whisperService.ensureAvailable()) {
                            if (!(await whisperService.checkModelLoaded())) {
                                showToast('Loading Whisper model...', 'info');
                                setProcessingStatus('Loading AI Model...');
                                await whisperService.loadModel(speechConfig?.whisperModelId || 'ggml-base');
                            }

                            setProcessingStatus('Transcribing file...');
                            // Whisper Plugin supports file input
                            const result = await whisperService.transcribeFile(wavPath, {
                                language: settings.transcriptionLanguage,
                                temperature: speechConfig?.whisperTemperature ?? 0.0,
                                beamSize: speechConfig?.whisperBeamSize ?? 5
                            });

                            if (result.segments && result.segments.length > 0) {
                                const segments = result.segments.map((seg, index) => ({
                                    id: `whisper_file_${Date.now()}_${index}`,
                                    speakerId: 0,
                                    text: seg.text.trim(),
                                    timestamp: Date.now() + seg.startMs
                                }));
                                setTranscript(segments);
                            } else if (result.text) {
                                setTranscript([{
                                    id: `whisper_file_${Date.now()}`,
                                    speakerId: 0,
                                    text: result.text.trim(),
                                    timestamp: Date.now()
                                }]);
                            }
                            showToast('Whisper transcription completed', 'success');

                            if (speechConfig?.enableWhisperDiarization) {
                                setProcessingStatus('Speaker Diarization...');
                                await fullAudioDiarization();
                            } else {
                                await saveMeeting();
                            }
                            return;
                        }
                    }

                    // Vosk Fallback for File (Chunked)
                    if (abortProcessingRef.current) throw new Error('Operazione annullata');

                    await (Vosk as any).startProcessing();
                    setProcessingStatus('Streaming to Vosk...');

                    const response = await fetch(Capacitor.convertFileSrc(wavPath));
                    const blob = await response.blob();

                    let offset = 44;
                    const CHUNK_SIZE = 32000;
                    const totalSize = blob.size;

                    while (offset < totalSize) {
                        if (abortProcessingRef.current) break;
                        const chunkBlob = blob.slice(offset, offset + CHUNK_SIZE);
                        const reader = new FileReader();
                        const base64 = await new Promise<string>((resolve, reject) => {
                            reader.onloadend = () => {
                                const res = reader.result as string;
                                resolve(res.split(',')[1]);
                            };
                            reader.onerror = reject;
                            reader.readAsDataURL(chunkBlob);
                        });

                        await (Vosk as any).submitAudio({ data: base64 });
                        offset += CHUNK_SIZE;

                        if (offset % (CHUNK_SIZE * 5) === 0) {
                            const progress = Math.round((offset / totalSize) * 100);
                            setProcessingStatus(`Processing: ${progress}%`);
                        }
                        await new Promise(r => setTimeout(r, 5));
                    }

                    await (Vosk as any).stopProcessing();
                    showToast('Reprocessing completed', 'success');
                    await saveMeeting();
                    return;

                } catch (e) {
                    logger.log('error', 'File reprocessing failed, falling back to legacy', e);
                }
            }

            // 2. LEGACY MEMORY BASED REPROCESSING
            let floatData: Float32Array;

            if (pcmAudioBlobRef.current) {
                logger.log('info', 'Using captured raw PCM data for reprocessing');
                setProcessingStatus('Reading PCM data...');
                const arrayBuffer = await pcmAudioBlobRef.current.arrayBuffer();
                const int16Data = new Int16Array(arrayBuffer.slice(44));
                floatData = new Float32Array(int16Data.length);
                for (let i = 0; i < int16Data.length; i++) {
                    floatData[i] = int16Data[i] / 32768.0;
                }
            } else {
                logger.log('warn', 'Raw PCM not available, retrieving from current audio');
                const response = await fetch(playback.recordedAudioUrl);
                const arrayBuffer = await response.arrayBuffer();
                const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
                const audioContext = new AudioContextClass();
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                const originalData = audioBuffer.getChannelData(0);
                floatData = downsampleBuffer(originalData, audioBuffer.sampleRate, 16000);
            }

            if (abortProcessingRef.current) throw new Error('Operazione annullata');

            setProcessingStatus('Analyzing audio signal...');
            const int16Data = floatToInt16(floatData);

            if (useWhisper) {
                try {
                    const whisperService = getWhisperSTTService();
                    const { blobTo16kHZPCM } = await import('../../services/audio/audioUtils');

                    if (await whisperService.ensureAvailable()) {
                        if (!(await whisperService.checkModelLoaded())) {
                            showToast('Loading Whisper model...', 'info');
                            setProcessingStatus('Loading AI Model...');
                            await whisperService.loadModel(speechConfig?.whisperModelId || 'ggml-base');
                        }

                        let base64Audio: string;
                        if (floatData && floatData.length > 0) {
                            base64Audio = arrayBufferToBase64(int16Data.buffer as ArrayBuffer);
                        } else {
                            const response = await fetch(playback.recordedAudioUrl);
                            const blob = await response.blob();
                            base64Audio = await blobTo16kHZPCM(blob);
                        }

                        setProcessingStatus('Transcribing...');
                        const result = await whisperService.transcribeAudio(base64Audio, {
                            language: settings.transcriptionLanguage,
                            temperature: speechConfig?.whisperTemperature ?? 0.0,
                            beamSize: speechConfig?.whisperBeamSize ?? 5
                        } as any, 'accurate');

                        if (result.segments && result.segments.length > 0) {
                            const segments = result.segments.map((seg, index) => ({
                                id: `whisper_${Date.now()}_${index}`,
                                speakerId: 0,
                                text: seg.text.trim(),
                                timestamp: Date.now()
                            }));
                            setTranscript(segments);
                        } else if (result.text) {
                            setTranscript([{
                                id: `whisper_${Date.now()}`,
                                speakerId: 0,
                                text: result.text.trim(),
                                timestamp: Date.now()
                            }]);
                        }

                        showToast('Whisper transcription completed', 'success');
                        if (speechConfig?.enableWhisperDiarization) {
                            setProcessingStatus('Speaker Diarization...');
                            await fullAudioDiarization();
                        } else {
                            await saveMeeting();
                        }
                        return;
                    }
                } catch (e) {
                    logger.log('error', 'Whisper failed, fallback to Vosk', e);
                    showToast('Whisper failed, using Vosk', 'info');
                }
            }

            // Vosk fallback (Legacy)
            await (Vosk as any).startProcessing();
            reprocessingStateRef.current = {
                audioData: floatData,
                currentOffset: 0,
                isReprocessing: true
            };

            const CHUNK_SIZE = 16000;
            for (let i = 0; i < int16Data.length; i += CHUNK_SIZE) {
                if (abortProcessingRef.current) break;
                reprocessingStateRef.current.currentOffset = Math.min(i + CHUNK_SIZE, int16Data.length);
                const chunk = int16Data.slice(i, i + CHUNK_SIZE);
                const base64 = arrayBufferToBase64(chunk.buffer as ArrayBuffer);
                await (Vosk as any).submitAudio({ data: base64 });
                await new Promise(r => setTimeout(r, 10));
            }

            await (Vosk as any).stopProcessing();
            showToast('Reprocessing completed', 'success');
            await saveMeeting();

        } catch (error) {
            logger.log('error', 'Reprocessing failed', error);
            showToast('Reprocessing error', 'error');
        } finally {
            setIsReclustering(false);
            reprocessingStateRef.current.isReprocessing = false;
            reprocessingStateRef.current.audioData = null;
        }
    };

    const fullAudioDiarization = async () => {
        if (!playback.recordedAudioUrl) {
            showToast('No audio to analyze', 'error');
            return;
        }

        if (transcript.length === 0) {
            showToast('No transcript to reprocess', 'info');
            return;
        }

        setIsReclustering(true);
        showToast('Full audio speaker analysis...', 'info');

        try {
            // TUNED FOR ECAPA-TDNN: longer windows = better embeddings
            const WINDOW_DURATION = 2.5;
            const HOP_DURATION = 0.5;
            const SAMPLE_RATE = 16000;
            const windowSamples = Math.floor(WINDOW_DURATION * SAMPLE_RATE);
            const hopSamples = Math.floor(HOP_DURATION * SAMPLE_RATE);

            const response = await fetch(playback.recordedAudioUrl);
            const arrayBuffer = await response.arrayBuffer();
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const audioContext = new AudioContextClass();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            const offlineCtx = new OfflineAudioContext(1, audioBuffer.duration * SAMPLE_RATE, SAMPLE_RATE);
            const source = offlineCtx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(offlineCtx.destination);
            source.start();
            const resampledBuffer = await offlineCtx.startRendering();
            const floatData = resampledBuffer.getChannelData(0);

            const embeddings: Array<{ timestamp: number; embedding: number[] }> = [];

            // --- VAD / Silence Filtering ---
            // Determine which audio regions contain speech to avoid extracting
            // embeddings from silence/noise (which pollutes clustering).
            let speechSegments: SpeechSegment[] | null = null;
            const vadEnabled = speechConfig?.enableVAD === true;

            if (vadEnabled) {
                try {
                    const vadService = getVADService();
                    const vadReady = await vadService.checkModelLoaded();
                    if (vadReady) {
                        // Process the full audio file through VAD to get speech regions
                        // We need to write a temporary WAV for VAD.processFile()
                        const int16Full = floatToInt16(floatData);
                        const base64Full = arrayBufferToBase64(int16Full.buffer as ArrayBuffer);
                        // Use processSamples for in-memory data instead of processFile
                        const vadResult = await vadService.processSamples(base64Full);
                        if (vadResult.isSpeech) {
                            showToast('VAD: Speech detected, filtering windows...', 'info');
                        }
                        // For full-audio VAD, we use processFile if available, otherwise
                        // fallback to RMS. Since processSamples is streaming-mode, we
                        // fall back to RMS gating for now and use VAD as a future enhancement.
                        logger.log('info', 'VAD model loaded but processFile requires file path; using RMS filter');
                    } else {
                        logger.log('info', 'VAD enabled but model not loaded, using RMS energy filter');
                    }
                } catch (vadErr) {
                    logger.log('warn', 'VAD check failed, using RMS energy filter', vadErr);
                }
            }

            // Use file-based VAD if we have a file path and VAD is ready
            if (vadEnabled && audioFilePathRef.current) {
                try {
                    const vadService = getVADService();
                    const vadReady = await vadService.checkModelLoaded();
                    if (vadReady) {
                        speechSegments = await vadService.processFile(audioFilePathRef.current);
                        if (speechSegments.length > 0) {
                            speechSegments = vadService.mergeSegments(speechSegments, 500);
                            logger.log('info', `VAD detected ${speechSegments.length} speech segments`);
                            showToast(`VAD: ${speechSegments.length} speech regions found`, 'info');
                        }
                    }
                } catch (vadErr) {
                    logger.log('warn', 'VAD file processing failed, using RMS filter', vadErr);
                    speechSegments = null;
                }
            }

            let skippedWindows = 0;
            for (let offset = 0; offset + windowSamples <= floatData.length; offset += hopSamples) {
                const segment = floatData.slice(offset, offset + windowSamples);
                const timestampMs = (offset / SAMPLE_RATE) * 1000;
                const windowEndMs = ((offset + windowSamples) / SAMPLE_RATE) * 1000;

                // --- Filter: Skip non-speech windows ---
                if (speechSegments && speechSegments.length > 0) {
                    // VAD-based: skip if window doesn't overlap any speech segment
                    const overlaps = speechSegments.some(seg =>
                        timestampMs < seg.endMs && windowEndMs > seg.startMs
                    );
                    if (!overlaps) {
                        skippedWindows++;
                        continue;
                    }
                } else {
                    // RMS energy fallback: skip silence windows
                    let sumSq = 0;
                    for (let i = 0; i < segment.length; i++) {
                        sumSq += segment[i] * segment[i];
                    }
                    const rms = Math.sqrt(sumSq / segment.length);
                    if (rms < 0.01) {
                        skippedWindows++;
                        continue;
                    }
                }

                const int16 = floatToInt16(segment);
                const base64Audio = arrayBufferToBase64(int16.buffer as ArrayBuffer);

                try {
                    const result = await SpeakerEmbeddingPlugin.extractEmbedding({ audioData: base64Audio });
                    if (result && result.embedding && result.embedding.length > 0) {
                        embeddings.push({ timestamp: timestampMs, embedding: result.embedding });
                    }
                } catch (e) {
                    // Skip failed extraction
                }
            }

            if (skippedWindows > 0) {
                logger.log('info', `Skipped ${skippedWindows} silence/noise windows`);
            }

            if (embeddings.length < 2) {
                showToast('Too few embeddings extracted', 'error');
                return;
            }

            // PASS 1: Global Clustering of Sliding Window Embeddings
            // This establishes the "Speaker Profiles" (Centroids) valid for the whole meeting
            const clustering = new SpeakerClustering((msg) => logger.log('debug', 'FullDiarization', msg));
            const storedEmbeddings = embeddings.map((e, i) => ({
                id: `grid_${i}`,
                embedding: e.embedding,
                timestamp: e.timestamp,
                originalSpeakerId: 0
            }));

            const clusterResult = clustering.cluster(storedEmbeddings, {
                targetSpeakers: settings.targetSpeakerCount,
                distanceThreshold: 1 - diarizationRef.current.similarityThreshold
            });

            showToast(`Pass 1: Profiles created for ${clusterResult.speakerCount} speakers`, 'info');

            // PASS 2: Re-assign Transcript Segments to Global Profiles
            // Improve assignment by looking at ALL embeddings in the segment's time window,
            // computing their average, and matching against the global centroids.

            // Sort transcript to ensure time order for window calculation
            const sortedTranscript = [...transcript].sort((a, b) => a.timestamp - b.timestamp);

            const updatedTranscript = sortedTranscript.map((seg, index) => {
                // Determine approximate time window for this segment
                // Start = timestamp of previous segment (or 0)
                // End = timestamp of this segment
                const prevTimestamp = index > 0 ? sortedTranscript[index - 1].timestamp : 0;
                const currTimestamp = seg.timestamp;
                const windowEnd = currTimestamp;
                const windowStart = Math.max(0, prevTimestamp);

                // Collect all sliding-window embeddings that fall within this segment's window
                // (Relaxed window: include slight overlap to catch boundaries)
                const relevantEmbeddings = embeddings.filter(e =>
                    e.timestamp >= windowStart - 500 && e.timestamp <= windowEnd + 500
                );

                if (relevantEmbeddings.length > 0) {
                    // Strategy A: Vote based on Pass 1 assignments (Simplest)
                    // Strategy B: Centroid Matching (More Robust for mixed segments)
                    // We use Strategy B: Average the embeddings in this window and match to closest Global Centroid

                    const avgEmbedding = new Array(relevantEmbeddings[0].embedding.length).fill(0);
                    for (const emb of relevantEmbeddings) {
                        for (let i = 0; i < emb.embedding.length; i++) {
                            avgEmbedding[i] += emb.embedding[i];
                        }
                    }
                    // Normalize average
                    const count = relevantEmbeddings.length;
                    for (let i = 0; i < avgEmbedding.length; i++) {
                        avgEmbedding[i] /= count;
                    }

                    // Match against Global Centroids from Pass 1
                    try {
                        const bestSpeakerId = clustering.findNearestSpeaker(avgEmbedding, clusterResult.centroids);
                        return { ...seg, speakerId: bestSpeakerId };
                    } catch (e) {
                        return { ...seg }; // Fallback
                    }
                } else {
                    // Fallback: If no embeddings found in window, use nearest neighbor
                    let bestEmbedding = embeddings[0];
                    let minDiff = Math.abs(seg.timestamp - embeddings[0].timestamp);

                    for (const emb of embeddings) {
                        const diff = Math.abs(seg.timestamp - emb.timestamp);
                        if (diff < minDiff) {
                            minDiff = diff;
                            bestEmbedding = emb;
                        }
                    }

                    const embIdx = embeddings.indexOf(bestEmbedding);
                    // Use the cluster assignment from Pass 1
                    const speakerId = clusterResult.speakerAssignments.get(`grid_${embIdx}`) ?? seg.speakerId;
                    return { ...seg, speakerId };
                }
            });

            // PASS 3: Temporal Smoothing
            const smoothingAlgo = speechConfig?.diarizationSmoothingAlgorithm || 'median';
            let smoothedTranscript = [...updatedTranscript];

            if (smoothingAlgo === 'hmm' && updatedTranscript.length > 0) {
                // HMM Viterbi Decoder for Temporal Smoothing
                // States: Unique speakers from Pass 2
                // Observations: Speaker IDs assigned in Pass 2
                const uniqueSpeakersSet = new Set(updatedTranscript.map(s => s.speakerId));
                const states = Array.from(uniqueSpeakersSet);
                const nStates = states.length;

                if (nStates > 1) {
                    const T = updatedTranscript.length;

                    // Transition Probabilities (A matrix)
                    // High probability to stay on the same speaker, lower to switch
                    const pStay = 0.95;
                    const pSwitch = (1.0 - pStay) / (nStates - 1);

                    // Emission / Observation Probabilities (B matrix)
                    // High probability that Pass 2 assignment is correct, low otherwise
                    const pCorrectObs = 0.85;
                    const pWrongObs = (1.0 - pCorrectObs) / (nStates - 1);

                    // Initialize Viterbi tables
                    // viterbi[t][j] = probability of most likely path ending in state j at time t
                    const viterbi: number[][] = Array(T).fill(0).map(() => Array(nStates).fill(0));
                    // backpointer[t][j] = most likely state at time t-1 given we are in state j at time t
                    const backpointer: number[][] = Array(T).fill(0).map(() => Array(nStates).fill(0));

                    // Initialization (t = 0)
                    const obs0 = updatedTranscript[0].speakerId;
                    for (let s = 0; s < nStates; s++) {
                        // Assuming uniform initial state distribution
                        const initialProb = 1.0 / nStates;
                        const emissionProb = states[s] === obs0 ? pCorrectObs : pWrongObs;
                        // Use log probabilities to prevent underflow
                        viterbi[0][s] = Math.log(initialProb) + Math.log(emissionProb);
                        backpointer[0][s] = 0;
                    }

                    // Recursion (t = 1 to T-1)
                    for (let t = 1; t < T; t++) {
                        const obs = updatedTranscript[t].speakerId;

                        for (let s = 0; s < nStates; s++) {
                            let maxLogProb = -Infinity;
                            let bestPrevState = 0;
                            const emissionProb = states[s] === obs ? pCorrectObs : pWrongObs;

                            for (let prevS = 0; prevS < nStates; prevS++) {
                                const transProb = states[prevS] === states[s] ? pStay : pSwitch;
                                const prob = viterbi[t - 1][prevS] + Math.log(transProb);

                                if (prob > maxLogProb) {
                                    maxLogProb = prob;
                                    bestPrevState = prevS;
                                }
                            }

                            viterbi[t][s] = maxLogProb + Math.log(emissionProb);
                            backpointer[t][s] = bestPrevState;
                        }
                    }

                    // Termination
                    let bestLastState = 0;
                    let maxFinalProb = -Infinity;
                    for (let s = 0; s < nStates; s++) {
                        if (viterbi[T - 1][s] > maxFinalProb) {
                            maxFinalProb = viterbi[T - 1][s];
                            bestLastState = s;
                        }
                    }

                    // Path backtracking
                    const bestPath = new Array(T);
                    bestPath[T - 1] = bestLastState;
                    for (let t = T - 1; t > 0; t--) {
                        bestPath[t - 1] = backpointer[t][bestPath[t]];
                    }

                    // Apply the smoothed path to the transcript
                    for (let t = 0; t < T; t++) {
                        smoothedTranscript[t] = {
                            ...updatedTranscript[t],
                            speakerId: states[bestPath[t]]
                        };
                    }
                }
            } else {
                // PASS 3: Temporal Median Filter (Original Logic)
                // Smooth out spurious speaker label oscillations (e.g. [0,1,0,0,0] → [0,0,0,0,0])
                const MEDIAN_WINDOW = 5;
                smoothedTranscript = updatedTranscript.map((seg, idx) => {
                    if (updatedTranscript.length < MEDIAN_WINDOW) return seg;

                    // Collect speaker IDs in the window centered on this segment
                    const halfW = Math.floor(MEDIAN_WINDOW / 2);
                    const start = Math.max(0, idx - halfW);
                    const end = Math.min(updatedTranscript.length - 1, idx + halfW);
                    const windowIds = updatedTranscript.slice(start, end + 1).map(s => s.speakerId);

                    // Find the mode (most frequent) speaker in the window
                    const freq = new Map<number, number>();
                    for (const id of windowIds) {
                        freq.set(id, (freq.get(id) ?? 0) + 1);
                    }
                    let modeId = seg.speakerId;
                    let maxFreq = 0;
                    for (const [id, count] of freq) {
                        if (count > maxFreq) {
                            maxFreq = count;
                            modeId = id;
                        }
                    }
                    return { ...seg, speakerId: modeId };
                });
            }

            setTranscript(smoothedTranscript);
            const uniqueSpeakers = new Set(smoothedTranscript.map(s => s.speakerId)).size;
            const smoothedCount = smoothedTranscript.filter((s, i) => s.speakerId !== updatedTranscript[i].speakerId).length;
            if (smoothedCount > 0) {
                logger.log('info', `Median filter corrected ${smoothedCount} segments`);
            }
            showToast(`Diarization complete (2-Pass + smoothing): ${uniqueSpeakers} speakers`, 'success');
            await saveMeeting();

        } catch (error) {
            logger.log('error', 'Full audio diarization failed', error);
            showToast('Audio diarization error', 'error');
        } finally {
            setIsReclustering(false);
        }
    };

    const reclusterSpeakers = async () => {
        const sessionEmbeddings = diarizationRef.current.getEmbeddingService().getSessionEmbeddings();

        if (sessionEmbeddings.length === 0) {
            showToast('No embeddings saved for clustering', 'info');
            return;
        }

        if (transcript.length === 0) {
            showToast('No transcript to reprocess', 'info');
            return;
        }

        setIsReclustering(true);
        showToast('Speaker reprocessing in progress...', 'info');

        try {
            const clustering = new SpeakerClustering((msg) => logger.log('debug', 'Clustering', msg));

            const storedEmbeddings = transcript
                .map(seg => {
                    const stored = sessionEmbeddings.find((e: any) => e.id === seg.id);
                    return stored ? {
                        id: seg.id,
                        embedding: stored.embedding,
                        timestamp: seg.timestamp,
                        originalSpeakerId: seg.speakerId
                    } : null;
                })
                .filter((s): s is NonNullable<typeof s> => s !== null && s.embedding.length > 0);

            const clusterResult = clustering.clusterWithAlgorithm(storedEmbeddings, settings.clusteringAlgorithm, {
                targetSpeakers: settings.targetSpeakerCount,
                distanceThreshold: 1 - diarizationRef.current.similarityThreshold
            });

            const newAssignments = clusterResult.speakerAssignments;
            const updatedTranscript = transcript.map(seg => ({
                ...seg,
                speakerId: newAssignments.get(seg.id) ?? seg.speakerId
            }));

            setTranscript(updatedTranscript);
            const uniqueSpeakers = new Set(updatedTranscript.map(s => s.speakerId)).size;
            showToast(`Reprocessing completed: ${uniqueSpeakers} speakers`, 'success');
            await saveMeeting();

        } catch (error) {
            logger.log('error', 'Re-clustering failed', error);
            showToast('Speaker reprocessing error', 'error');
        } finally {
            setIsReclustering(false);
        }
    };

    return {
        isReclustering,
        processingStatus,
        reprocessMeeting,
        fullAudioDiarization,
        reclusterSpeakers,
        handleCancelProcessing,
        reprocessingStateRef
    };
};
