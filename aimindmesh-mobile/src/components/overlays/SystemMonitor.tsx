import React, { useState, useEffect } from 'react';
import { registerPlugin } from '@capacitor/core';

interface SystemStats {
    ram: {
        total: number;
        available: number;
        used: number;
        threshold: number;
        lowMemory: boolean;
        appUsed: number;
    };
    cpu: number;
    gpu: number;
}

interface SystemMonitorPlugin {
    getStats(): Promise<SystemStats>;
}

const SystemMonitorPlugin = registerPlugin<SystemMonitorPlugin>('SystemMonitor');

interface SystemMonitorProps {
    frequency: number;
    showRam: boolean;
    showAppRam: boolean;
    showCpu: boolean;
    showGpu: boolean;
}

const SystemMonitor: React.FC<SystemMonitorProps> = ({
    frequency,
    showRam,
    showAppRam,
    showCpu,
    showGpu
}) => {
    const [stats, setStats] = useState<SystemStats | null>(null);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const result = await SystemMonitorPlugin.getStats();
                setStats(result);
            } catch (e) {
                console.error('Failed to fetch system stats', e);
            }
        };

        // Initial fetch
        fetchStats();

        const interval = setInterval(fetchStats, frequency);
        return () => clearInterval(interval);
    }, [frequency]);

    if (!stats) return null;

    // Convert bytes to GB/MB
    const totalRAM = (stats.ram.total / (1024 * 1024 * 1024)).toFixed(1);
    const usedRAM = (stats.ram.used / (1024 * 1024 * 1024)).toFixed(1);
    const appRAM = (stats.ram.appUsed / (1024 * 1024)).toFixed(0); // MB

    // Color helpers
    const getLoadColor = (usage: number) => {
        if (usage < 50) return 'text-green-400';
        if (usage < 80) return 'text-yellow-400';
        return 'text-red-400';
    };

    return (
        <div className="fixed top-0 left-1/2 transform -translate-x-1/2 z-[60] 
                        bg-black/60 backdrop-blur-md border-b border-x border-white/10 
                        rounded-b-lg px-4 py-1.5 flex items-center gap-4 pointer-events-none shadow-lg shadow-black/50">
            {/* RAM Section */}
            {showRam && (
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                    <span className="text-[10px] font-mono text-blue-200">
                        RAM: {usedRAM}/{totalRAM} GB
                    </span>
                </div>
            )}

            {showRam && (showAppRam || showCpu || showGpu) && (
                <div className="w-px h-3 bg-white/20"></div>
            )}

            {/* App RAM Section */}
            {showAppRam && (
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-purple-200">
                        APP: {appRAM} MB
                    </span>
                </div>
            )}

            {showAppRam && (showCpu || showGpu) && (
                <div className="w-px h-3 bg-white/20"></div>
            )}

            {/* CPU Section */}
            {showCpu && (
                <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-mono ${getLoadColor(stats.cpu)}`}>
                        CPU: {stats.cpu.toFixed(1)}%
                    </span>
                </div>
            )}

            {showCpu && showGpu && (
                <div className="w-px h-3 bg-white/20"></div>
            )}

            {/* GPU Section */}
            {showGpu && (
                <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-mono ${getLoadColor(stats.gpu)}`}>
                        GPU: {stats.gpu.toFixed(0)}%
                    </span>
                </div>
            )}
        </div>
    );
};

export default SystemMonitor;
