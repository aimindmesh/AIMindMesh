import React from 'react';
import { RecoverableSession } from '../../services/audio/meetingRecorder';

interface RecoveryBannerProps {
    sessions: RecoverableSession[];
    busySessionId: string | null;
    onRecover: (session: RecoverableSession) => void;
    onDiscard: (session: RecoverableSession) => void;
}

const formatDuration = (ms: number) => {
    const totalSec = Math.round(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m ${s.toString().padStart(2, '0')}s`;
};

/** Offers the recordings that a crash or a kill left unsaved, one at a time. */
const RecoveryBanner: React.FC<RecoveryBannerProps> = ({ sessions, busySessionId, onRecover, onDiscard }) => {
    if (sessions.length === 0) return null;
    const session = sessions[0];
    const busy = busySessionId !== null;

    return (
        <div className="mx-4 mt-3 p-3 rounded-lg border border-amber-400/30 bg-amber-500/10 flex flex-col gap-2">
            <div className="text-sm text-amber-100">
                <span className="font-semibold">Interrupted recording found</span>
                {sessions.length > 1 && <span className="text-amber-200/70"> (+{sessions.length - 1} more)</span>}
                <div className="text-xs text-amber-200/80 mt-0.5">
                    {new Date(session.startedAt).toLocaleString()} · {formatDuration(session.durationMs)} of audio
                </div>
            </div>
            <div className="flex gap-2 justify-end">
                <button
                    onClick={() => onDiscard(session)}
                    disabled={busy}
                    className="px-3 py-1.5 rounded-md text-xs text-text-secondary hover:text-white hover:bg-white/5 disabled:opacity-50"
                >
                    Discard
                </button>
                <button
                    onClick={() => onRecover(session)}
                    disabled={busy}
                    className="px-3 py-1.5 rounded-md text-xs font-semibold bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-50"
                >
                    {busySessionId === session.sessionId ? 'Recovering…' : 'Recover'}
                </button>
            </div>
        </div>
    );
};

export default RecoveryBanner;
