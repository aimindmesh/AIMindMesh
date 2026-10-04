import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, TranscriptSegment } from '../../types/meeting';
import { CloseIcon, FlagIcon, MicrophoneIcon, PencilIcon } from '../../constants';
import { anchorBookmarks, findActiveSegment } from '../../services/meeting/transcriptTimeline';
import { formatClock } from '../../services/llm/meetingPrompts';
import { speakerLabel } from '../../services/meeting/speakerEdits';

interface MeetingTranscriptProps {
    transcript: TranscriptSegment[];
    currentText: string;
    speakerNames: Record<number, string>;
    bookmarks: Bookmark[];
    /** Tapping a sentence's speaker (rename, or move the sentence to another speaker). */
    onSpeakerMenu: (segment: TranscriptSegment) => void;
    onSegmentEdit?: (segment: TranscriptSegment, newText: string) => void;
    /** Plays the recording from `ms`; absent when there is no audio to play. */
    onSeek?: (ms: number) => void;
    onBookmarkSelect?: (bookmark: Bookmark) => void;
    onRemoveBookmark?: (bookmark: Bookmark) => void;
    /** Player position (ms) while playing, to highlight and follow what is being heard. */
    playbackMs: number | null;
    isPlaying: boolean;
    /** Recording now: follow the newest text, unless the user scrolled up to read. */
    isLive: boolean;
    /** Scrolls to a segment and highlights it briefly (e.g. a search result). */
    focus: { segmentId: string; nonce: number } | null;
    emptyMessage: string;
    isProcessing?: boolean;
    processingStatus?: string;
    /** Shows a Cancel button in the processing status */
    onCancelProcessing?: () => void;
    className?: string;
}

const SPEAKER_COLORS = [
    'text-sky-300 bg-sky-400/10',
    'text-amber-300 bg-amber-400/10',
    'text-emerald-300 bg-emerald-400/10',
    'text-pink-300 bg-pink-400/10',
    'text-violet-300 bg-violet-400/10',
    'text-orange-300 bg-orange-400/10',
];

/** After the user scrolls by hand, playback doesn't move the transcript for this long. */
const MANUAL_SCROLL_PAUSE_MS = 4000;

/** Edit buttons: always visible on touch screens, on hover with a mouse. */
const TOUCH_VISIBLE = 'opacity-60 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus:opacity-100';

interface SegmentRowProps {
    segment: TranscriptSegment;
    speakerLabel: string;
    isActive: boolean;
    isFlashing: boolean;
    canSeek: boolean;
    canEdit: boolean;
    /** Stable for the life of the transcript: rows re-render only when their own props change. */
    actions: React.MutableRefObject<{
        seek: (ms: number) => void;
        speakerMenu: (segment: TranscriptSegment) => void;
        edit: (segment: TranscriptSegment, newText: string) => void;
    }>;
}

/** One sentence. Memoized: during playback or a live transcript only the rows that change re-render. */
const SegmentRow = React.memo<SegmentRowProps>(({ segment, speakerLabel, isActive, isFlashing, canSeek, canEdit, actions }) => {
    const [editText, setEditText] = useState<string | null>(null);
    const color = SPEAKER_COLORS[Math.abs(segment.speakerId) % SPEAKER_COLORS.length];
    const seek = () => canSeek && actions.current.seek(segment.start_ms!);

    const save = () => {
        if (editText !== null && editText.trim() && editText.trim() !== segment.text) {
            actions.current.edit(segment, editText.trim());
        }
        setEditText(null);
    };

    return (
        <div
            data-segment-id={segment.id}
            className={`flex flex-col gap-1 p-2 rounded-lg transition-colors group animate-fade-in [content-visibility:auto] [contain-intrinsic-size:auto_88px] ${isActive
                ? 'bg-primary/15 ring-1 ring-primary/40'
                : isFlashing ? 'bg-amber-400/15 ring-1 ring-amber-400/40' : 'hover:bg-white/5'
                }`}
        >
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <button
                        onClick={() => actions.current.speakerMenu(segment)}
                        className={`text-xs font-bold px-2 py-0.5 rounded-full truncate max-w-[60vw] hover:underline ${color}`}
                        title={'Change the speaker'}
                    >
                        {speakerLabel}
                    </button>
                    <button
                        onClick={seek}
                        disabled={!canSeek}
                        className="text-xs text-text-secondary font-mono enabled:hover:text-white"
                        title={canSeek ? 'Play from here' : undefined}
                    >
                        {segment.start_ms !== undefined
                            ? formatClock(segment.start_ms)
                            : new Date(segment.timestamp).toLocaleTimeString()}
                        {segment.isEdited && ` · ${'edited'}`}
                    </button>
                </div>

                {canEdit && editText === null && (
                    <button
                        onClick={() => setEditText(segment.text)}
                        className={`p-1.5 bg-surface-hover text-text-secondary rounded-full hover:text-white transition-opacity ${TOUCH_VISIBLE}`}
                        title={'Edit text'}
                        aria-label={'Edit text'}
                    >
                        <PencilIcon className="w-4 h-4" />
                    </button>
                )}
            </div>

            {editText !== null ? (
                <div className="mt-2 flex flex-col gap-2">
                    <textarea
                        className="w-full bg-surface-hover text-white border border-white/20 rounded p-2 text-sm focus:outline-none focus:border-primary resize-none min-h-[60px]"
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        autoFocus
                    />
                    <div className="flex justify-end gap-2">
                        <button
                            onClick={() => setEditText(null)}
                            className="px-3 py-1.5 text-xs text-text-secondary hover:text-white transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={save}
                            className="px-3 py-1.5 text-xs bg-primary text-white rounded hover:bg-primary-dark transition-colors"
                        >
                            Save
                        </button>
                    </div>
                </div>
            ) : (
                <p
                    className={`text-white pl-2 border-l-2 ${isActive ? 'border-primary' : 'border-surface'} ${canSeek ? 'cursor-pointer' : ''}`}
                    onClick={seek}
                >
                    {segment.text}
                </p>
            )}
        </div>
    );
});

const MeetingTranscript: React.FC<MeetingTranscriptProps> = ({
    transcript,
    currentText,
    speakerNames,
    bookmarks,
    onSpeakerMenu,
    onSegmentEdit,
    onSeek,
    onBookmarkSelect,
    onRemoveBookmark,
    playbackMs,
    isPlaying,
    isLive,
    focus,
    emptyMessage,
    isProcessing,
    processingStatus,
    onCancelProcessing,
    className = ''
}) => {
    const [flashId, setFlashId] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const stickToBottomRef = useRef(true);
    const manualScrollAtRef = useRef(0);

    const actions = useRef({ seek: (_ms: number) => { }, speakerMenu: onSpeakerMenu, edit: (_s: TranscriptSegment, _t: string) => { } });
    actions.current = {
        seek: ms => onSeek?.(ms),
        speakerMenu: onSpeakerMenu,
        edit: (segment, text) => onSegmentEdit?.(segment, text)
    };
    const bookmarkActions = useRef({ select: onBookmarkSelect, remove: onRemoveBookmark });
    bookmarkActions.current = { select: onBookmarkSelect, remove: onRemoveBookmark };
    const canSelectBookmark = !!onBookmarkSelect;
    const canRemoveBookmark = !!onRemoveBookmark;
    const canSeekAny = !!onSeek;
    const canEdit = !!onSegmentEdit;

    const activeIndex = playbackMs === null ? -1 : findActiveSegment(transcript, playbackMs);
    const activeId = activeIndex >= 0 ? transcript[activeIndex].id : null;
    const anchors = useMemo(() => anchorBookmarks(transcript, bookmarks), [transcript, bookmarks]);

    const handleScroll = () => {
        const el = containerRef.current;
        if (!el) return;
        stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    };
    const handleManualScroll = () => {
        manualScrollAtRef.current = Date.now();
    };

    // Live: keep the newest text in view while the user is at the bottom
    useLayoutEffect(() => {
        const el = containerRef.current;
        if (el && isLive && stickToBottomRef.current) {
            el.scrollTop = el.scrollHeight;
        }
    }, [transcript, currentText, isLive]);

    // Playback: follow the segment being heard
    useEffect(() => {
        if (!activeId || !isPlaying || Date.now() - manualScrollAtRef.current < MANUAL_SCROLL_PAUSE_MS) return;
        containerRef.current?.querySelector(`[data-segment-id="${CSS.escape(activeId)}"]`)
            ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, [activeId, isPlaying]);

    // Jump to a segment (search result, note) and highlight it
    useEffect(() => {
        if (!focus) return;
        const el = containerRef.current?.querySelector(`[data-segment-id="${CSS.escape(focus.segmentId)}"]`);
        el?.scrollIntoView({ block: 'center' });
        manualScrollAtRef.current = Date.now();
        setFlashId(focus.segmentId);
        const timer = setTimeout(() => setFlashId(null), 2500);
        return () => clearTimeout(timer);
    }, [focus]);

    const renderBookmarks = useCallback((list: Bookmark[] | undefined) => list?.map(bookmark => (
        <div key={bookmark.id} className="flex items-center gap-2 pl-1 text-amber-300">
            <button
                onClick={() => bookmarkActions.current.select?.(bookmark)}
                disabled={!canSelectBookmark}
                className="flex items-center gap-1.5 text-xs font-medium hover:underline disabled:no-underline"
                title={'Play from this moment'}
            >
                <FlagIcon className="w-4 h-4" />
                <span className="font-mono">{formatClock(bookmark.ms)}</span>
                <span>{bookmark.note || 'Marked moment'}</span>
            </button>
            {canRemoveBookmark && (
                <button
                    onClick={() => bookmarkActions.current.remove?.(bookmark)}
                    className="p-1 text-text-secondary hover:text-white"
                    title={'Remove this mark'}
                    aria-label={'Remove this mark'}
                >
                    <CloseIcon className="w-3.5 h-3.5" />
                </button>
            )}
        </div>
    )), [canSelectBookmark, canRemoveBookmark]);

    // Rebuilt only when what it shows changes, not at every player tick or live partial result
    const rows = useMemo(() => transcript.map((segment, index) => (
        <React.Fragment key={segment.id}>
            {renderBookmarks(anchors.get(index))}
            <SegmentRow
                segment={segment}
                speakerLabel={speakerLabel(segment.speakerId, speakerNames)}
                isActive={segment.id === activeId}
                isFlashing={segment.id === flashId}
                canSeek={canSeekAny && segment.start_ms !== undefined}
                canEdit={canEdit}
                actions={actions}
            />
        </React.Fragment>
    )), [transcript, anchors, speakerNames, activeId, flashId, canSeekAny, canEdit, renderBookmarks]);

    const isEmpty = transcript.length === 0 && !currentText;

    return (
        <div
            ref={containerRef}
            onScroll={handleScroll}
            onTouchMove={handleManualScroll}
            onWheel={handleManualScroll}
            className={`flex-1 overflow-y-auto p-4 space-y-3 ${className}`}
        >
            {isEmpty && (
                <div className="h-full flex flex-col items-center justify-center text-center text-text-secondary opacity-60 px-6">
                    <MicrophoneIcon className="w-16 h-16 mb-4" />
                    <p>{emptyMessage}</p>
                    {renderBookmarks(bookmarks)}
                </div>
            )}

            {rows}

            {!isEmpty && renderBookmarks(anchors.get(-1))}

            {currentText && (
                <div className="flex flex-col gap-1 opacity-70">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-text-secondary">
                            Detecting...
                        </span>
                    </div>
                    <p className="text-white pl-2 border-l-2 border-primary/50 italic">{currentText}</p>
                </div>
            )}

            {/* Processing Status Overlay */}
            {isProcessing && (
                <div className="sticky bottom-4 left-0 right-0 flex justify-center z-10 pointer-events-none">
                    <div className="bg-surface/90 backdrop-blur-md border border-primary/30 px-4 py-2 rounded-full shadow-lg flex items-center gap-3 animate-fade-in">
                        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                        <span className="text-sm font-medium text-white shadow-sm">
                            {processingStatus || 'Processing...'}
                        </span>
                        {onCancelProcessing && (
                            <button
                                onClick={onCancelProcessing}
                                className="pointer-events-auto text-xs text-text-secondary hover:text-white underline"
                            >
                                Cancel
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default MeetingTranscript;
