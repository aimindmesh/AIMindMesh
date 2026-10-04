import React, { useEffect, useMemo, useState } from 'react';
import { CloseIcon, FlagIcon, SearchIcon, SparklesIcon, TrashIcon } from '../../constants';
import { logger } from '../../services/logger';
import { deleteMeeting } from '../../services/meeting/meetingStorage';
import { listMeetings, searchTranscripts, SegmentMatch } from '../../services/meeting/meetingRecords';
import { displayTitle, formatMeetingDate } from '../../services/meeting/meetingNotes';
import { findMatch, notesText, snippetAround, Snippet } from '../../services/meeting/meetingSearch';
import { formatClock } from '../../services/llm/meetingPrompts';
import { MeetingSummary } from '../../types/meeting';
import { askConfirm } from '../../services/ui/dialogs';

interface MeetingHistoryProps {
    isOpen: boolean;
    onClose: () => void;
    /** Opens a meeting, scrolled to `segmentId` when given (a search result). */
    onOpenMeeting: (meetingId: string, segmentId?: string) => void;
    /** The meeting on screen was deleted. */
    onDeleted: (meetingId: string) => void;
    currentMeetingId: string | null;
    /** The meeting being recorded, which can't be deleted now. */
    recordingMeetingId: string | null;
}

/** How many transcript passages a search shows per meeting. */
const SNIPPETS_PER_MEETING = 3;

function formatDuration(seconds: number): string {
    if (!isFinite(seconds) || seconds <= 0) return '';
    const total = Math.round(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h} h ${m} min`;
    if (m > 0) return `${m} min${s ? ` ${s} s` : ''}`;
    return `${s} s`;
}

const Highlighted: React.FC<{ snippet: Snippet }> = ({ snippet }) => (
    <>
        {snippet.before}
        <mark className="bg-amber-400/30 text-white rounded px-0.5">{snippet.match}</mark>
        {snippet.after}
    </>
);

const MeetingHistory: React.FC<MeetingHistoryProps> = ({ isOpen, onClose, onOpenMeeting, onDeleted, currentMeetingId, recordingMeetingId }) => {
    const [meetings, setMeetings] = useState<MeetingSummary[] | null>(null);
    const [query, setQuery] = useState('');
    const [transcriptMatches, setTranscriptMatches] = useState<Map<string, SegmentMatch[]>>(new Map());
    const [isSearching, setIsSearching] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        listMeetings()
            .then(setMeetings)
            .catch(error => {
                logger.log('error', 'Failed to load meetings', error);
                setMeetings([]);
            });
    }, [isOpen]);

    // Transcript search, debounced while typing
    useEffect(() => {
        const q = query.trim();
        if (!isOpen || q.length < 2) {
            setTranscriptMatches(new Map());
            setIsSearching(false);
            return;
        }
        setIsSearching(true);
        let cancelled = false;
        const timer = setTimeout(() => {
            searchTranscripts(q)
                .then(matches => { if (!cancelled) setTranscriptMatches(matches); })
                .catch(error => logger.log('error', 'Search failed', error))
                .finally(() => { if (!cancelled) setIsSearching(false); });
        }, 250);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [query, isOpen]);

    const q = query.trim();
    const searching = q.length >= 2;

    const results = useMemo(() => {
        if (!meetings) return [];
        if (!searching) return meetings.map(meeting => ({ meeting, notesSnippet: null, matches: [] as SegmentMatch[] }));
        return meetings
            .map(meeting => {
                const notes = notesText(meeting);
                const dateMatch = findMatch(formatMeetingDate(meeting.timestamp), q);
                return {
                    meeting,
                    notesSnippet: snippetAround(notes, q, 50),
                    dateMatch: !!dateMatch,
                    matches: transcriptMatches.get(meeting.id) ?? []
                };
            })
            .filter(r => r.notesSnippet || r.dateMatch || r.matches.length > 0);
    }, [meetings, searching, q, transcriptMatches]);

    const handleDelete = async (meeting: MeetingSummary) => {
        const ok = await askConfirm({
            title: `Delete "${displayTitle(meeting)}"?`,
            message: 'The transcript, the notes and the recording are deleted. This cannot be undone.',
            confirmLabel: 'Delete',
            danger: true
        });
        if (!ok) return;
        if (await deleteMeeting(meeting.id)) {
            setMeetings(list => list?.filter(m => m.id !== meeting.id) ?? null);
            onDeleted(meeting.id);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-stretch md:items-center justify-center md:p-6" onClick={onClose}>
            <div
                className="bg-surface md:rounded-2xl shadow-2xl w-full md:max-w-2xl md:max-h-[90vh] flex flex-col pt-safe md:pt-0"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-4 pt-4 pb-3 border-b border-white/10 space-y-3">
                    <div className="flex justify-between items-center">
                        <h2 className="text-lg font-bold text-white">Meetings</h2>
                        <button onClick={onClose} className="p-1 text-text-secondary hover:text-white" aria-label={'Close'}>
                            <CloseIcon className="w-6 h-6" />
                        </button>
                    </div>
                    <div className="relative">
                        <SearchIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                        <input
                            type="search"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder={'Search titles, notes and transcripts'}
                            className="w-full pl-9 pr-3 py-2.5 bg-background border border-white/10 rounded-xl text-sm text-white placeholder-text-secondary/60 focus:border-primary focus:outline-none"
                        />
                    </div>
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto pb-safe">
                    {meetings === null ? (
                        <div className="p-8 flex justify-center">
                            <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
                        </div>
                    ) : results.length === 0 ? (
                        <p className="p-8 text-center text-text-secondary text-sm">
                            {searching ? (isSearching ? 'Searching…' : `Nothing found for "${q}"`) : 'No saved meetings yet'}
                        </p>
                    ) : (
                        <ul className="divide-y divide-white/5">
                            {results.map(({ meeting, notesSnippet, matches }) => {
                                // An untitled meeting is already titled by its date
                                const titled = !!(meeting.title || meeting.analysis?.title);
                                const details = [
                                    titled ? formatMeetingDate(meeting.timestamp) : '',
                                    formatDuration(meeting.duration),
                                    meeting.speakerCount > 1 ? `${meeting.speakerCount} speakers` : '',
                                    meeting.segmentCount === 0 ? (meeting.hasAudio ? 'not transcribed' : 'empty') : '',
                                ].filter(Boolean).join(' · ');
                                const shown = matches.slice(0, SNIPPETS_PER_MEETING);
                                return (
                                    <li key={meeting.id} className={meeting.id === currentMeetingId ? 'bg-primary/10' : ''}>
                                        <div className="flex items-start gap-2 px-4 py-3">
                                            <button
                                                onClick={() => onOpenMeeting(meeting.id)}
                                                className="flex-1 min-w-0 text-left"
                                            >
                                                <p className="text-sm font-semibold text-white truncate">{displayTitle(meeting)}</p>
                                                <p className="text-xs text-text-secondary mt-0.5 flex flex-wrap items-center gap-x-1.5">
                                                    <span>{details}</span>
                                                    {meeting.bookmarks.length > 0 && (
                                                        <span className="inline-flex items-center gap-0.5 text-amber-300">
                                                            <FlagIcon className="w-3 h-3" />{meeting.bookmarks.length}
                                                        </span>
                                                    )}
                                                    {meeting.analysis && <SparklesIcon className="w-3 h-3 text-yellow-400" />}
                                                </p>
                                                {notesSnippet ? (
                                                    <p className="text-xs text-text-secondary mt-1 line-clamp-2"><Highlighted snippet={notesSnippet} /></p>
                                                ) : !searching && (meeting.analysis?.summary || meeting.preview) ? (
                                                    <p className="text-xs text-text-secondary mt-1 line-clamp-2">
                                                        {meeting.analysis?.summary || `“${meeting.preview}”`}
                                                    </p>
                                                ) : null}
                                            </button>
                                            <button
                                                onClick={() => handleDelete(meeting)}
                                                disabled={meeting.id === recordingMeetingId}
                                                className="p-2 -mr-2 text-text-secondary enabled:hover:text-red-400 disabled:opacity-30"
                                                title={'Delete meeting'}
                                                aria-label={'Delete meeting'}
                                            >
                                                <TrashIcon className="w-4 h-4" />
                                            </button>
                                        </div>

                                        {shown.length > 0 && (
                                            <ul className="pb-2 pl-4 pr-4 space-y-1">
                                                {shown.map(match => {
                                                    const snippet = snippetAround(match.text, q, 50);
                                                    return (
                                                        <li key={match.segmentId}>
                                                            <button
                                                                onClick={() => onOpenMeeting(meeting.id, match.segmentId)}
                                                                className="w-full text-left text-xs text-text-secondary hover:bg-white/5 rounded-lg px-2 py-1.5 flex gap-2"
                                                            >
                                                                <span className="font-mono text-primary shrink-0">{formatClock(match.startMs)}</span>
                                                                <span className="min-w-0">{snippet ? <Highlighted snippet={snippet} /> : match.text}</span>
                                                            </button>
                                                        </li>
                                                    );
                                                })}
                                                {matches.length > shown.length && (
                                                    <li className="text-[11px] text-text-secondary px-2">
                                                        {`+${matches.length - shown.length} more in this meeting`}
                                                    </li>
                                                )}
                                            </ul>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
};

export default MeetingHistory;
