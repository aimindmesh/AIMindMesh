import React, { useRef, useEffect } from 'react';
import { LogEntry } from '../../../services/logger';
import { Clipboard } from '@capacitor/clipboard';
import { triggerHaptic } from '../../../services/native';

interface LogViewerProps {
    logEntries: LogEntry[];
    isLoggingEnabled: boolean;
    onLoggingToggle: () => void;
    onClearLogs: () => void;
}

const LogViewer: React.FC<LogViewerProps> = ({
    logEntries,
    isLoggingEnabled,
    onLoggingToggle,
    onClearLogs
}) => {
    const logContainerRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom of logs
    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logEntries]);

    const handleCopyLogs = async () => {
        const content = logEntries.map(entry => {
            const time = new Date(entry.timestamp).toISOString();
            const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : '';
            return `[${time}] [${entry.level.toUpperCase()}] ${entry.message}${dataStr}`;
        }).join('\n');

        await Clipboard.write({ string: content });
        triggerHaptic();
        alert('Logs copied to clipboard!');
    };

    return (
        <div className="flex flex-col h-full space-y-4 animate-fade-in p-6">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium text-text-primary">Logs</h3>
                <button
                    onClick={onLoggingToggle}
                    className={`text-xs px-2 py-1 rounded ${isLoggingEnabled ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}`}
                >
                    {isLoggingEnabled ? 'Enabled' : 'Disabled'}
                </button>
            </div>

            <div ref={logContainerRef} className="flex-1 overflow-y-auto bg-surface/50 p-3 rounded-md font-mono text-xs text-text-secondary whitespace-pre-wrap max-h-[400px]">
                {logEntries.map((entry, i) => (
                    <div key={i} className="mb-1 border-b border-white/5 pb-1">
                        <span className="text-gray-500">{new Date(entry.timestamp).toLocaleTimeString()}</span>{' '}
                        <span className={entry.level === 'error' ? 'text-red-400' : 'text-blue-400'}>[{entry.level.toUpperCase()}]</span>{' '}
                        {entry.message}
                        {entry.data && entry.data.length > 0 && (
                            <div className="pl-4 text-[10px] text-gray-400 break-all">
                                {entry.data.map((d, index) => (
                                    <div key={index}>{typeof d === 'string' ? d : JSON.stringify(d, null, 2)}</div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
                {logEntries.length === 0 && (
                    <div className="text-center text-gray-500 italic py-4">No logs available.</div>
                )}
            </div>

            <div className="flex space-x-2">
                <button onClick={handleCopyLogs} className="flex-1 py-2 bg-primary/20 text-primary border border-primary/20 rounded hover:bg-primary/30 transition-colors">Copy to Clipboard</button>
                <button onClick={onClearLogs} className="flex-1 py-2 bg-surface text-text-secondary rounded hover:bg-surface/80">Clear</button>
            </div>
        </div>
    );
};

export default LogViewer;
