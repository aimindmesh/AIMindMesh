/**
 * Firebase block of the AIMindMesh Server settings: the device's FCM token, forced
 * re-registration and the last push deliveries.
 */

import React from 'react';
import { AIMindMeshServerSettings } from '../../../types';
import { FcmLog } from '../../../services/llm/providers/serverProvider';

interface Props {
    settings: AIMindMeshServerSettings;
    localToken: string | null;
    isRegistering: boolean;
    handleForceRegister: () => void;
    fcmLogs: FcmLog[];
}

const labelCls = 'text-sm font-medium text-text-secondary';

const ServerFcmSection: React.FC<Props> = ({ settings, localToken, isRegistering, handleForceRegister, fcmLogs }) => (
    <>
        <div className="space-y-3 bg-primary/5 p-4 rounded-xl border border-primary/10">
            <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-primary uppercase tracking-tight">Firebase Registration</p>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${localToken ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-500'}`}>
                    {localToken ? 'TOKEN DETECTED' : 'MISSING TOKEN'}
                </span>
            </div>

            <div className="bg-black/20 p-2.5 rounded-lg border border-white/5">
                <p className="text-[9px] text-text-tertiary uppercase mb-1">Local FCM Token</p>
                <p className="text-[10px] font-mono text-text-secondary break-all leading-relaxed">
                    {localToken ? `${localToken.substring(0, 40)}...` : 'Not generated yet. Ensure you are on a real device and granted notification permissions.'}
                </p>
            </div>

            <button
                onClick={handleForceRegister}
                disabled={isRegistering || !settings.enabled}
                className="w-full py-2 bg-primary/20 hover:bg-primary/30 border border-primary/30 text-primary rounded-lg text-[11px] font-bold transition-all disabled:opacity-30 flex items-center justify-center gap-2"
            >
                {isRegistering ? (
                    <>
                        <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                        Synchronizing with Gateway...
                    </>
                ) : (
                    <>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Force Refresh & Sync Token
                    </>
                )}
            </button>
        </div>

        {/* FCM Logs */}
        <div className="space-y-2">
            <p className={labelCls}>Recent FCM Telegrams</p>
            <div className="bg-surface/30 rounded-lg border border-white/5 overflow-hidden">
                {fcmLogs.length === 0 ? (
                    <div className="p-4 text-center text-xs text-text-secondary opacity-50">No recent logs</div>
                ) : fcmLogs.map(log => (
                    <div key={log.id} className="p-3 border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors">
                        <div className="flex justify-between items-start mb-1">
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${log.status === 'SUCCESS' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                                {log.status}
                            </span>
                            <span className="text-[9px] text-text-tertiary">
                                {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                        </div>
                        <p className="text-xs text-text-primary truncate">{log.message}</p>
                        <p className="text-[10px] text-text-secondary truncate mt-0.5">To: {log.recipient}</p>
                    </div>
                ))}
            </div>
        </div>
    </>
);

export default ServerFcmSection;
