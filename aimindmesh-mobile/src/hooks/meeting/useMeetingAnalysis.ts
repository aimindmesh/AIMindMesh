import { useCallback, useRef, useState } from 'react';
import { AIMindMeshServerSettings, LLMConfig } from '../../types';
import { Bookmark, MeetingAnalysis, MeetingQuestion, TranscriptSegment } from '../../types/meeting';
import {
    describeTaskModel,
    isTaskLLMConfigured,
    stripThinking,
    streamTaskCompletion,
    supportsTaskAudio,
    TaskKeys
} from '../../services/llm/taskCompletion';
import {
    buildAudioAnalysisPrompt,
    buildQuestionPrompt,
    buildTranscriptAnalysisPrompt,
    guessLanguage,
    MEETING_SYSTEM_PROMPT,
    parseAnalysis
} from '../../services/llm/meetingPrompts';
import { logger } from '../../services/logger';
import { describeAIError } from '../../services/llm/aiErrors';

/** Output budgets: notes of a long meeting need room (thinking models count their thoughts too). */
const ANALYSIS_MAX_TOKENS = 16384;
const QUESTION_MAX_TOKENS = 4096;

export interface AIJob {
    meetingId: string;
    kind: 'analysis' | 'question';
    /** Characters received so far, to show that the model is writing. */
    received: number;
    question?: string;
    /** The answer so far, for questions. */
    partial?: string;
}

/** What the AI needs to know about a meeting. */
export interface MeetingContext {
    meetingId: string;
    transcript: TranscriptSegment[];
    speakerNames: Record<number, string>;
    bookmarks: Bookmark[];
    questions: MeetingQuestion[];
    /** The transcription language when set explicitly ('auto' otherwise). */
    language: string;
    /** The recording, for the audio analysis (filePath: the native file, for on-device models). */
    audio?: { url: string; mimeType: string | null; filePath?: string | null };
}

interface Options {
    llmConfig: LLMConfig;
    keys: TaskKeys;
    serverSettings?: AIMindMeshServerSettings;
    showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
    /** Receives finished notes for `meetingId`, which may no longer be on screen. */
    onAnalysis: (meetingId: string, analysis: MeetingAnalysis) => Promise<void> | void;
    onQuestion: (meetingId: string, question: MeetingQuestion) => Promise<void> | void;
}

function resolveLanguage(ctx: MeetingContext): string | undefined {
    if (ctx.language && ctx.language !== 'auto') return ctx.language;
    return guessLanguage(ctx.transcript.map(t => t.text).join(' '));
}

const isAbort = (e: any) => e?.name === 'AbortError' || /abort/i.test(e?.message ?? '');

/**
 * AI notes and questions about a meeting, through the configured cloud (or local) model.
 * One request at a time; results are handed back by meeting id.
 */
export function useMeetingAnalysis({ llmConfig, keys, serverSettings, showToast, onAnalysis, onQuestion }: Options) {
    const [job, setJob] = useState<AIJob | null>(null);
    const controllerRef = useRef<AbortController | null>(null);
    const optionsRef = useRef({ llmConfig, keys, serverSettings, showToast, onAnalysis, onQuestion });
    optionsRef.current = { llmConfig, keys, serverSettings, showToast, onAnalysis, onQuestion };

    const run = useCallback(async (
        initial: AIJob,
        stream: (signal: AbortSignal) => AsyncGenerator<string>,
        finish: (text: string) => Promise<void> | void
    ): Promise<boolean> => {
        const { llmConfig: config, keys, serverSettings, showToast: toast } = optionsRef.current;
        if (controllerRef.current) {
            toast('The AI is still answering: wait or cancel it', 'info');
            return false;
        }
        if (!isTaskLLMConfigured(config, keys, serverSettings)) {
            toast('Set up an AI provider in Settings first', 'info');
            return false;
        }
        const controller = new AbortController();
        controllerRef.current = controller;
        setJob(initial);
        let text = '';
        try {
            for await (const chunk of stream(controller.signal)) {
                text += chunk;
                const received = text.length;
                setJob(j => j && { ...j, received, partial: initial.kind === 'question' ? text : undefined });
            }
            text = stripThinking(text);
            if (!text.trim()) {
                throw new Error('The model returned an empty answer');
            }
            await finish(text);
            return true;
        } catch (e: any) {
            if (isAbort(e) || controller.signal.aborted) {
                toast('AI request cancelled', 'info');
            } else {
                logger.log('error', `AI ${initial.kind} failed`, e?.message ?? e);
                toast(`AI request failed: ${describeAIError(e)}`, 'error');
            }
            return false;
        } finally {
            controllerRef.current = null;
            setJob(null);
        }
    }, []);

    /** Structured notes from the transcript, or from the recording itself with Gemini. */
    const analyze = useCallback((ctx: MeetingContext, source: 'transcript' | 'audio' = 'transcript') => {
        const { llmConfig: config, keys, serverSettings } = optionsRef.current;
        const useAudio = source === 'audio' && !!ctx.audio && supportsTaskAudio(config, serverSettings);
        if (source === 'audio' && !useAudio) {
            if (!ctx.audio) {
                optionsRef.current.showToast('This meeting has no recording to analyze', 'info');
                return Promise.resolve(false);
            }
            optionsRef.current.showToast(`${describeTaskModel(config, serverSettings)} can't listen to audio: analyzing the transcript instead`, 'info');
        }
        if (!useAudio && ctx.transcript.length === 0) {
            optionsRef.current.showToast('No transcript to analyze yet', 'info');
            return Promise.resolve(false);
        }
        const language = resolveLanguage(ctx);
        const meta = { source: useAudio ? 'audio' as const : 'transcript' as const, model: describeTaskModel(config, serverSettings), createdAt: Date.now() };

        return run(
            { meetingId: ctx.meetingId, kind: 'analysis', received: 0 },
            signal => streamTaskCompletion({
                system: MEETING_SYSTEM_PROMPT,
                prompt: useAudio
                    ? buildAudioAnalysisPrompt({ bookmarks: ctx.bookmarks, language })
                    : buildTranscriptAnalysisPrompt({ ...ctx, language }),
                llmConfig: config,
                keys,
                serverSettings,
                maxTokens: ANALYSIS_MAX_TOKENS,
                json: true,
                signal,
                audio: useAudio
                    ? { url: ctx.audio!.url, filePath: ctx.audio!.filePath, mimeType: ctx.audio!.mimeType || 'audio/mp4' }
                    : undefined
            }),
            async text => {
                const analysis = parseAnalysis(text, meta);
                await optionsRef.current.onAnalysis(ctx.meetingId, analysis);
                optionsRef.current.showToast(analysis.markdown ? 'AI notes ready (unstructured)' : 'AI notes ready', 'success');
            }
        );
    }, [run]);

    /** Answers a question about the meeting from its transcript. */
    const ask = useCallback((ctx: MeetingContext, question: string) => {
        const trimmed = question.trim();
        if (!trimmed) return Promise.resolve(false);
        if (ctx.transcript.length === 0) {
            optionsRef.current.showToast('No transcript to ask about yet', 'info');
            return Promise.resolve(false);
        }
        const { llmConfig: config, keys, serverSettings } = optionsRef.current;
        return run(
            { meetingId: ctx.meetingId, kind: 'question', received: 0, question: trimmed, partial: '' },
            signal => streamTaskCompletion({
                system: MEETING_SYSTEM_PROMPT,
                prompt: buildQuestionPrompt(ctx, ctx.questions, trimmed),
                llmConfig: config,
                keys,
                serverSettings,
                maxTokens: QUESTION_MAX_TOKENS,
                signal
            }),
            async text => {
                await optionsRef.current.onQuestion(ctx.meetingId, {
                    id: `q_${Date.now()}`,
                    question: trimmed,
                    answer: text.trim(),
                    createdAt: Date.now()
                });
            }
        );
    }, [run]);

    const cancel = useCallback(() => controllerRef.current?.abort(), []);

    return { job, analyze, ask, cancel, isConfigured: isTaskLLMConfigured(llmConfig, keys, serverSettings) };
}
