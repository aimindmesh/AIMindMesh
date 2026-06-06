import React, { useState, useEffect, useRef } from 'react';
import { setupService, SetupProgress } from '../../../services/setupService';
import { AIMindMeshServerSettings } from '../../../types';
import { triggerHaptic } from '../../../services/native';

interface SetupSettingsProps {
    serverSettings: AIMindMeshServerSettings;
}

const SetupSettings: React.FC<SetupSettingsProps> = ({ serverSettings }) => {
    const [progress, setProgress] = useState<SetupProgress>({
        currentStepIndex: 0,
        totalSteps: 0,
        currentStepName: '',
        percentage: 0,
        status: 'idle',
        logs: []
    });

    const logsEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setupService.setProgressListener((p) => {
            setProgress(p);
            // If completed, we could trigger a callback to parent to refresh settings
            // but setupService already updates localStorage, and SettingsModal 
            // uses its own local state which might need manual update.
        });
    }, []);

    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [progress.logs]);

    const handleStartSetup = async () => {
        if (!serverSettings.serverUrl || !serverSettings.apiKey) {
            alert('Please configure Server URL and API Key in the "AIMindMesh Server" tab first.');
            return;
        }

        const confirm = window.confirm(
            'This will download several GB of models. Please ensure you are on a stable WiFi connection. Start now?'
        );

        if (confirm) {
            triggerHaptic('MEDIUM');
            await setupService.runOneClickSetup(serverSettings.serverUrl, serverSettings.apiKey);
        }
    };

    const getStatusColor = () => {
        switch (progress.status) {
            case 'completed': return 'text-green-400';
            case 'failed': return 'text-red-400';
            case 'downloading': return 'text-primary';
            case 'installing': return 'text-purple-400';
            default: return 'text-text-secondary';
        }
    };

    return (
        <div className="space-y-6">
            <header>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    🚀 One-Click Configuration
                </h3>
                <p className="text-sm text-text-secondary mt-1">
                    Automatically download and configure all necessary AI models from your AIMindMesh Server.
                </p>
            </header>

            <div className="bg-surface/30 border border-white/5 rounded-xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <div className={`text-sm font-bold ${getStatusColor()} uppercase tracking-wider`}>
                            Status: {progress.status.replace('_', ' ')}
                        </div>
                        <div className="text-xs text-text-secondary">
                            {progress.status === 'idle' 
                                ? 'Ready to start fresh installation' 
                                : `Step ${progress.currentStepIndex + 1} of ${progress.totalSteps}: ${progress.currentStepName}`}
                        </div>
                    </div>
                    {progress.status === 'idle' || progress.status === 'completed' || progress.status === 'failed' ? (
                        <button
                            onClick={handleStartSetup}
                            className="px-6 py-2.5 rounded-lg bg-primary hover:bg-primary-dark text-white font-bold shadow-lg shadow-primary/20 transition-all active:scale-95"
                        >
                            {progress.status === 'completed' ? 'Restart Setup' : 'Start Configuration'}
                        </button>
                    ) : (
                        <div className="text-2xl animate-spin">⏳</div>
                    )}
                </div>

                {/* Progress Bar */}
                <div className="space-y-2">
                    <div className="flex justify-between text-xs font-medium text-text-secondary">
                        <span>Overall Progress</span>
                        <span>{Math.round(progress.percentage)}%</span>
                    </div>
                    <div className="h-3 w-full bg-white/10 rounded-full overflow-hidden border border-white/5">
                        <div 
                            className="h-full bg-gradient-to-r from-primary to-purple-500 transition-all duration-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                            style={{ width: `${progress.percentage}%` }}
                        />
                    </div>
                </div>
            </div>

            {/* Log Viewer */}
            <div className="space-y-2">
                <div className="text-xs font-bold text-text-secondary uppercase tracking-widest px-1">Setup Logs</div>
                <div className="bg-black/40 border border-white/5 rounded-xl p-4 h-64 overflow-y-auto font-mono text-[11px] leading-relaxed">
                    {progress.logs.length === 0 && (
                        <div className="text-text-secondary/30 italic">Logs will appear here during setup...</div>
                    )}
                    <div className="flex flex-col-reverse">
                        {progress.logs.map((log, i) => (
                            <div key={i} className={`py-0.5 border-b border-white/5 last:border-0 ${
                                log.includes('✓') ? 'text-green-400/80' : 
                                log.includes('✗') ? 'text-red-400/80' : 
                                log.includes('CRITICAL') ? 'text-red-500 font-bold' :
                                'text-text-secondary'
                            }`}>
                                {log}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 flex gap-3">
                <span className="text-lg">⚠️</span>
                <div className="text-xs text-yellow-200/80 leading-relaxed">
                    <strong>Warning:</strong> This process will overwrite any existing model paths in your settings. 
                    Ensure your phone has at least 10GB of free storage before proceeding.
                </div>
            </div>
        </div>
    );
};

export default SetupSettings;
