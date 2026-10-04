import React from 'react';
import { FlagIcon, PencilIcon, SparklesIcon } from '../../constants';

export type MeetingView = 'transcript' | 'notes';

interface MeetingTitleBarProps {
    title: string;
    /** The date, or a hint to rename when the title already is the date. */
    date: string;
    bookmarkCount: number;
    /** AI notes plus questions, shown on the Notes tab. */
    notesCount: number;
    /** An AI request for this meeting is running. */
    isAIBusy: boolean;
    view: MeetingView;
    onViewChange: (view: MeetingView) => void;
    onRename: () => void;
}

/** The meeting on screen: its title (tap to rename) and the Transcript / Notes tabs. */
const MeetingTitleBar: React.FC<MeetingTitleBarProps> = ({
    title, date, bookmarkCount, notesCount, isAIBusy, view, onViewChange, onRename
}) => {
    const tab = (active: boolean) =>
        `px-3 py-1.5 rounded-md flex items-center gap-1.5 ${active ? 'bg-primary text-white' : 'text-text-secondary hover:text-white'}`;

    return (
        <div className="px-4 py-2 border-b border-surface flex flex-wrap items-center gap-x-3 gap-y-2">
            <button onClick={onRename} className="flex-1 min-w-[12rem] text-left group" title={'Rename this meeting'}>
                <p className="text-sm font-semibold text-white truncate flex items-center gap-1.5">
                    <span className="truncate">{title}</span>
                    <PencilIcon className="w-3.5 h-3.5 shrink-0 text-text-secondary group-hover:text-white" />
                </p>
                <p className="text-[11px] text-text-secondary flex items-center gap-1.5">
                    <span>{date}</span>
                    {bookmarkCount > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-amber-300">
                            · <FlagIcon className="w-3 h-3" />{bookmarkCount}
                        </span>
                    )}
                </p>
            </button>
            <div className="flex bg-surface rounded-lg p-1 border border-white/5 text-xs font-medium">
                <button onClick={() => onViewChange('transcript')} className={tab(view === 'transcript')}>
                    Transcript
                </button>
                <button onClick={() => onViewChange('notes')} className={tab(view === 'notes')}>
                    <SparklesIcon className="w-3.5 h-3.5" />
                    Notes{notesCount > 0 ? ` (${notesCount})` : ''}
                    {isAIBusy && <span className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse" />}
                </button>
            </div>
        </div>
    );
};

export default MeetingTitleBar;
