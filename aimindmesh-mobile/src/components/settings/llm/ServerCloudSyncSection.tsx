/**
 * "Cloud Sync & Shared Memory" block of the AIMindMesh Server settings: sync status, pending
 * items and the manual sync button.
 */

import React from 'react';
import { AIMindMeshServerSettings } from '../../../types';
import { triggerHaptic } from '../../../services/native';

interface Props {
    settings: AIMindMeshServerSettings;
    isSyncing?: boolean;
    onSync?: () => void;
    unsyncedCount: number | null;
    testStatus: 'idle' | 'loading' | 'ok' | 'error';
}

const ServerCloudSyncSection: React.FC<Props> = ({ settings, isSyncing, onSync, unsyncedCount, testStatus }) => (
    <div className="mt-8 border-t border-white/5 pt-6 space-y-4">
        <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-bold text-text-primary uppercase tracking-wider">☁️ Cloud Sync & Shared Memory</span>
        </div>

        <div className="bg-gradient-to-br from-primary/10 to-purple-500/10 p-4 rounded-xl border border-primary/20">
            <div className="flex items-center justify-between mb-3">
                <div>
                    <div className="text-sm font-bold text-text-primary">Ecosystem Sync</div>
                    <div className="text-[10px] text-text-secondary">Keep meetings, chats, and knowledge aligned across devices</div>
                </div>
                <div className="text-[10px] font-mono text-primary/70">
                    {localStorage.getItem('last_sync_timestamp') 
                        ? `Last: ${new Date(parseInt(localStorage.getItem('last_sync_timestamp')!)).toLocaleTimeString()}`
                        : 'Never synced'}
                </div>
            </div>

            <button
                onClick={() => { triggerHaptic('MEDIUM'); onSync?.(); }}
                disabled={isSyncing || !settings.enabled || !settings.serverUrl}
                className={`w-full py-3 rounded-xl flex items-center justify-center gap-3 transition-all ${
                    isSyncing 
                    ? 'bg-primary/20 text-primary cursor-not-allowed' 
                    : 'bg-primary text-white shadow-lg shadow-primary/20 hover:opacity-90 active:scale-[0.98]'
                }`}
            >
                {isSyncing ? (
                    <>
                        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                        <span className="text-sm font-bold">Synchronizing Knowledge...</span>
                    </>
                ) : (
                    <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                        </svg>
                        <span className="text-sm font-bold">Sync Now</span>
                    </>
                )}
            </button>

             <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="p-2 bg-black/20 rounded-lg border border-white/5 flex flex-col items-center">
                    <span className="text-[9px] text-text-tertiary uppercase">Local Queue</span>
                    <span className={`text-xs font-bold ${unsyncedCount === 0 ? 'text-green-500' : 'text-text-primary'}`}>
                        {unsyncedCount === null ? '...' : (unsyncedCount === 0 ? 'CLEAN' : `${unsyncedCount} ITEMS`)}
                    </span>
                </div>
                <div className="p-2 bg-black/20 rounded-lg border border-white/5 flex flex-col items-center">
                    <span className="text-[9px] text-text-tertiary uppercase">Cloud Status</span>
                    <span className={`text-xs font-bold ${testStatus === 'ok' ? 'text-green-500' : (testStatus === 'error' ? 'text-red-500' : 'text-text-secondary')}`}>
                        {testStatus === 'ok' ? 'CONNECTED' : (testStatus === 'loading' ? 'WAITING...' : 'OFFLINE')}
                    </span>
                </div>
            </div>
        </div>
    </div>
);

export default ServerCloudSyncSection;
