import React, { useState } from 'react';
import { exportAllMeetings, restoreFromBackup } from '../../services/meeting/backup';
import { logger } from '../../services/logger';
import { showAlert } from '../../services/ui/dialogs';

const formatBytes = (bytes: number) =>
    bytes > 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;

/** Export every meeting to one archive, and restore one. */
export const BackupSection: React.FC = () => {
    const [status, setStatus] = useState<string | null>(null);
    const busy = status !== null;

    const run = async (work: () => Promise<void>) => {
        try {
            await work();
        } catch (e: any) {
            logger.log('error', 'Backup operation failed', e);
            await showAlert({ title: 'Something went wrong', message: e?.message || String(e) });
        } finally {
            setStatus(null);
        }
    };

    const handleExport = () => run(async () => {
        const result = await exportAllMeetings(setStatus);
        await showAlert({
            title: 'Backup ready',
            message: `${result.meetings} meetings and ${result.recordings} recordings (${formatBytes(result.bytes)}).`
                + ' ' + 'Keep the file somewhere safe, such as Drive or a computer: it is not encrypted.'
        });
    });

    const handleRestore = () => run(async () => {
        const summary = await restoreFromBackup(setStatus);
        if (!summary) return;
        await showAlert({
            title: 'Backup restored',
            message: [
                `Meetings added: ${summary.added} (${summary.recordings} with their recording).`,
                summary.skipped ? `Already on this phone and left as they are: ${summary.skipped}.` : '',
                summary.voices ? `Known voices added: ${summary.voices}.` : ''
            ].filter(Boolean).join(' ')
        });
    });

    return (
        <div className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-3">
            <div>
                <h4 className="text-sm font-semibold text-white">Backup</h4>
                <p className="text-xs text-text-secondary mt-0.5">
                    All meetings in one file: transcripts, notes, marked moments, recordings and known voices. Save it outside the phone, and restore it on this or another phone.
                </p>
            </div>
            <div className="flex flex-wrap gap-2">
                <button
                    onClick={handleExport}
                    disabled={busy}
                    className="px-3 py-2 rounded-lg bg-primary text-white text-xs font-medium disabled:opacity-50"
                >
                    Back up all meetings
                </button>
                <button
                    onClick={handleRestore}
                    disabled={busy}
                    className="px-3 py-2 rounded-lg bg-surface border border-white/10 text-white text-xs font-medium disabled:opacity-50"
                >
                    Restore a backup
                </button>
            </div>
            {status && (
                <p className="text-xs text-text-secondary flex items-center gap-2">
                    <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    {status}
                </p>
            )}
        </div>
    );
};
