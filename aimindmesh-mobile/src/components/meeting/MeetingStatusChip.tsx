import React, { useEffect, useState } from 'react';
import type { MeetingBusyState } from './MeetingMode';

interface MeetingStatusChipProps {
    busy: MeetingBusyState;
    onOpen: () => void;
}

const clock = (ms: number) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

/** A meeting recording or transcribing while its screen is closed: tap to reopen it. */
const MeetingStatusChip: React.FC<MeetingStatusChipProps> = ({ busy, onOpen }) => {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (!busy.recording) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [busy.recording]);

    const label = busy.recording
        ? `Recording${busy.startedAt ? ` ${clock(now - busy.startedAt)}` : ''}`
        : busy.processing ?? 'Meeting';

    return (
        <button
            onClick={onOpen}
            className="fixed top-2 left-1/2 -translate-x-1/2 z-40 mt-safe px-4 py-1.5 rounded-full bg-surface/95 border border-white/10 shadow-lg flex items-center gap-2 text-xs text-white backdrop-blur"
            title="Open the meeting"
        >
            <span className={`w-2 h-2 rounded-full ${busy.recording ? 'bg-red-500 animate-pulse' : 'bg-purple-400 animate-pulse'}`} />
            <span className="font-medium truncate max-w-[60vw]">{label}</span>
        </button>
    );
};

export default MeetingStatusChip;
