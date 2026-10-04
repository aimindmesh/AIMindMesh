import React, { useState } from 'react';
import Markdown from 'react-markdown';
import { ChatIcon, CloseIcon, FlagIcon, SparklesIcon } from '../../constants';
import { AnalysisPoint, MeetingAnalysis, MeetingQuestion } from '../../types/meeting';
import { AIJob } from '../../hooks/meeting/useMeetingAnalysis';
import { formatClock, parseClock } from '../../services/llm/meetingPrompts';
import { ExternalLink, KEY_PAGES } from '../settings/AIProviderGuide';

interface MeetingNotesPanelProps {
    analysis: MeetingAnalysis | null;
    questions: MeetingQuestion[];
    bookmarkCount: number;
    /** The AI request running for this meeting, if any. */
    job: AIJob | null;
    /** Another meeting's AI request is running. */
    isBusyElsewhere: boolean;
    isConfigured: boolean;
    canAnalyzeAudio: boolean;
    hasTranscript: boolean;
    onAnalyze: (source: 'transcript' | 'audio') => void;
    onAsk: (question: string) => void;
    onCancel: () => void;
    onDeleteQuestion: (question: MeetingQuestion) => void;
    onOpenSettings?: () => void;
    /** Plays the recording from `ms`; absent without audio. */
    onSeek?: (ms: number) => void;
    className?: string;
}

const TimeChip: React.FC<{ ms?: number; onSeek?: (ms: number) => void }> = ({ ms, onSeek }) => {
    if (ms === undefined) return null;
    return (
        <button
            onClick={() => onSeek?.(ms)}
            disabled={!onSeek}
            className="ml-1.5 inline-flex px-1.5 py-0.5 rounded bg-primary/15 text-primary text-[11px] font-mono align-middle enabled:hover:bg-primary/30"
            title={onSeek ? 'Play this moment' : undefined}
        >
            {formatClock(ms)}
        </button>
    );
};

/** Markdown with [m:ss] times turned into buttons that play the recording there. */
const AnswerMarkdown: React.FC<{ text: string; onSeek?: (ms: number) => void }> = ({ text, onSeek }) => (
    <div className="prose-notes">
        <Markdown
            components={{
                a: ({ href, children }) => {
                    const ms = href?.startsWith('#t=') ? parseClock(href.slice(3)) : undefined;
                    if (ms !== undefined) {
                        return <TimeChip ms={ms} onSeek={onSeek} />;
                    }
                    return <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">{children}</a>;
                }
            }}
        >
            {text.replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\](?!\()/g, '[$1](#t=$1)')}
        </Markdown>
    </div>
);

const PointList: React.FC<{ title: string; points: AnalysisPoint[]; onSeek?: (ms: number) => void }> = ({ title, points, onSeek }) => {
    if (points.length === 0) return null;
    return (
        <section>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-1.5">{title}</h4>
            <ul className="space-y-1.5 list-disc pl-5 marker:text-text-secondary">
                {points.map((p, i) => (
                    <li key={i}>{p.text}<TimeChip ms={p.atMs} onSeek={onSeek} /></li>
                ))}
            </ul>
        </section>
    );
};

const MeetingNotesPanel: React.FC<MeetingNotesPanelProps> = ({
    analysis,
    questions,
    bookmarkCount,
    job,
    isBusyElsewhere,
    isConfigured,
    canAnalyzeAudio,
    hasTranscript,
    onAnalyze,
    onAsk,
    onCancel,
    onDeleteQuestion,
    onOpenSettings,
    onSeek,
    className = ''
}) => {
    const [question, setQuestion] = useState('');
    const busy = !!job || isBusyElsewhere;

    const submitQuestion = (e: React.FormEvent) => {
        e.preventDefault();
        if (!question.trim() || busy) return;
        onAsk(question);
        setQuestion('');
    };

    const analyzeButtons = (
        <div className="flex flex-wrap gap-2">
            <button
                onClick={() => onAnalyze('transcript')}
                disabled={busy || !hasTranscript}
                className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs flex items-center gap-2 disabled:opacity-50"
            >
                <SparklesIcon className="w-4 h-4" />
                {analysis ? 'Redo from transcript' : 'Summarize transcript'}
            </button>
            {canAnalyzeAudio && (
                <button
                    onClick={() => onAnalyze('audio')}
                    disabled={busy}
                    className="px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium text-xs flex items-center gap-2 disabled:opacity-50"
                    title={'Gemini listens to the recording itself'}
                >
                    <SparklesIcon className="w-4 h-4" />
                    {analysis ? 'Redo from audio' : 'Summarize from audio'}
                </button>
            )}
        </div>
    );

    return (
        <div className={`flex-1 overflow-y-auto p-4 space-y-5 text-sm text-text-primary ${className}`}>
            {!isConfigured && (
                <div className="p-4 rounded-xl border border-white/10 bg-surface/40 space-y-2">
                    <p className="text-white font-medium">AI notes and questions</p>
                    <p className="text-text-secondary text-xs">
                        Connect an AI service to get a summary, decisions and to-dos, and to ask questions about the meeting. The simplest is Google Gemini: get a free key, then paste it in Settings → AI. The meeting is sent only when you ask.
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <ExternalLink href={KEY_PAGES.gemini!} className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs no-underline">
                            1. Get a free key
                        </ExternalLink>
                        {onOpenSettings && (
                            <button onClick={onOpenSettings} className="px-3 py-1.5 rounded-lg bg-surface border border-white/10 text-white text-xs">
                                2. Paste it in Settings
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* ── Notes ───────────────────────── */}
            {job?.kind === 'analysis' ? (
                <div className="flex items-center gap-3 p-4 rounded-xl border border-primary/30 bg-primary/5">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent" />
                    <span className="flex-1 text-text-secondary">
                        {job.received > 0 ? `Writing notes… ${job.received.toLocaleString()} characters` : 'Sending the meeting to the AI…'}
                    </span>
                    <button onClick={onCancel} className="text-xs text-text-secondary hover:text-white underline">Cancel</button>
                </div>
            ) : analysis ? (
                <div className="space-y-4">
                    <div className="flex items-start justify-between gap-2">
                        <div>
                            <h3 className="font-bold text-white flex items-center gap-2">
                                <SparklesIcon className="w-5 h-5 text-yellow-400" />
                                AI notes
                            </h3>
                            <p className="text-[11px] text-text-secondary mt-0.5">
                                {analysis.model} · {analysis.source === 'audio' ? 'from the recording' : 'from the transcript'} · {new Date(analysis.createdAt).toLocaleString()}
                            </p>
                        </div>
                    </div>

                    {analysis.markdown ? (
                        <AnswerMarkdown text={analysis.markdown} onSeek={onSeek} />
                    ) : (
                        <>
                            {analysis.summary && <p className="leading-relaxed">{analysis.summary}</p>}
                            <PointList title={'Key points'} points={analysis.keyPoints} onSeek={onSeek} />
                            <PointList title={'Decisions'} points={analysis.decisions} onSeek={onSeek} />
                            {analysis.actionItems.length > 0 && (
                                <section>
                                    <h4 className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-1.5">Action items</h4>
                                    <ul className="space-y-2">
                                        {analysis.actionItems.map((a, i) => (
                                            <li key={i} className="flex gap-2">
                                                <span className="mt-0.5 w-4 h-4 shrink-0 rounded border border-white/30" />
                                                <span>
                                                    {a.task}
                                                    {a.owner && <span className="ml-1.5 text-[11px] px-1.5 py-0.5 rounded bg-white/10 text-text-secondary">{a.owner}</span>}
                                                    {a.due && <span className="ml-1.5 text-[11px] px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-300">{a.due}</span>}
                                                    <TimeChip ms={a.atMs} onSeek={onSeek} />
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            )}
                            <PointList title={'Open questions'} points={analysis.openQuestions} onSeek={onSeek} />
                        </>
                    )}
                    {isConfigured && analyzeButtons}
                </div>
            ) : isConfigured ? (
                <div className="space-y-3">
                    <p className="text-text-secondary">
                        Get a summary with the decisions, the action items and the open questions.
                        {bookmarkCount > 0 && (
                            <span className="inline-flex items-center gap-1 ml-1 text-amber-300">
                                <FlagIcon className="w-3.5 h-3.5" /> {(bookmarkCount === 1 ? 'The marked moment gets special attention.' : `The ${bookmarkCount} marked moments get special attention.`)}
                            </span>
                        )}
                    </p>
                    {analyzeButtons}
                </div>
            ) : null}

            {/* ── Questions ───────────────────── */}
            {(isConfigured || questions.length > 0) && (
                <section className="space-y-3 pt-4 border-t border-white/10">
                    <h3 className="font-bold text-white flex items-center gap-2">
                        <ChatIcon className="w-5 h-5 text-sky-300" />
                        Ask about this meeting
                    </h3>

                    {questions.map(q => (
                        <div key={q.id} className="space-y-1.5 p-3 rounded-xl bg-surface/40 border border-white/5">
                            <div className="flex items-start justify-between gap-2">
                                <p className="font-medium text-white">{q.question}</p>
                                <button
                                    onClick={() => onDeleteQuestion(q)}
                                    className="p-1 text-text-secondary hover:text-white shrink-0"
                                    title={'Delete this question'}
                                    aria-label={'Delete this question'}
                                >
                                    <CloseIcon className="w-3.5 h-3.5" />
                                </button>
                            </div>
                            <AnswerMarkdown text={q.answer} onSeek={onSeek} />
                        </div>
                    ))}

                    {job?.kind === 'question' && (
                        <div className="space-y-1.5 p-3 rounded-xl bg-surface/40 border border-primary/30">
                            <div className="flex items-start justify-between gap-2">
                                <p className="font-medium text-white">{job.question}</p>
                                <button onClick={onCancel} className="text-xs text-text-secondary hover:text-white underline shrink-0">Cancel</button>
                            </div>
                            {job.partial
                                ? <AnswerMarkdown text={job.partial} onSeek={onSeek} />
                                : <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent" />}
                        </div>
                    )}

                    {isConfigured && (
                        <form onSubmit={submitQuestion} className="flex gap-2">
                            <input
                                value={question}
                                onChange={e => setQuestion(e.target.value)}
                                placeholder={hasTranscript ? 'e.g. What did we decide about the budget?' : 'Transcribe the meeting first'}
                                disabled={!hasTranscript}
                                enterKeyHint="send"
                                className="flex-1 min-w-0 px-3 py-2 bg-surface border border-white/10 rounded-lg text-sm text-white placeholder-text-secondary/60 focus:border-primary focus:outline-none disabled:opacity-50"
                            />
                            <button
                                type="submit"
                                disabled={busy || !question.trim() || !hasTranscript}
                                className="px-3 py-2 rounded-lg bg-primary text-white text-xs font-medium disabled:opacity-50"
                            >
                                Ask
                            </button>
                        </form>
                    )}
                    {isBusyElsewhere && <p className="text-[11px] text-text-secondary">The AI is busy with another meeting.</p>}
                </section>
            )}
        </div>
    );
};

export default MeetingNotesPanel;
