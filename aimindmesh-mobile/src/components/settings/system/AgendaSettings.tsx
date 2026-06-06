/**
 * Agenda Settings Component
 * Settings for the agenda feature including default view, system calendar integration, and data import/export
 */

import React, { useState, useEffect } from 'react';
import { triggerHaptic } from '../../../services/native';
import {
    AgendaSettings as AgendaSettingsType,
    exportAgendaData,
    importAgendaData,
    clearAllAgendaData,
    getAgendaStats,
    checkSystemCalendarPermissions,
    requestSystemCalendarPermissions,
} from '../../../services/calendar/calendarService';
import { FileSystemAdapter as Filesystem, Directory, Encoding } from '../../../utils/fileSystemAdapter';
import { Clipboard } from '@capacitor/clipboard';
import { logger } from '../../../services/logger';

interface AgendaSettingsProps {
    settings: AgendaSettingsType;
    onSettingsChange: (settings: AgendaSettingsType) => void;
}

const AgendaSettings: React.FC<AgendaSettingsProps> = ({
    settings,
    onSettingsChange,
}) => {
    const [stats, setStats] = useState<{ eventCount: number; noteCount: number } | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [hasSystemCalendarPermission, setHasSystemCalendarPermission] = useState(false);
    const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

    // Load stats on mount
    useEffect(() => {
        loadStats();
        checkPermissions();
    }, []);

    const loadStats = async () => {
        try {
            const agendaStats = await getAgendaStats();
            setStats(agendaStats);
        } catch (error) {
            logger.log('error', '[AgendaSettings] Failed to load stats', error);
        }
    };

    const checkPermissions = async () => {
        const hasPermission = await checkSystemCalendarPermissions();
        setHasSystemCalendarPermission(hasPermission);
    };

    const handleExportData = async () => {
        setIsLoading(true);
        try {
            const jsonData = await exportAgendaData();
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `agenda_backup_${timestamp}.json`;

            await Filesystem.writeFile({
                path: filename,
                data: jsonData,
                directory: Directory.Documents,
                encoding: Encoding.UTF8,
            });

            // Copy path to clipboard for user
            const fileUri = await Filesystem.getUri({ path: filename, directory: Directory.Documents });
            await Clipboard.write({ string: fileUri.uri });

            setStatusMessage({ type: 'success', text: `Agenda esportata! Path copiato: ${filename}` });
            triggerHaptic();
        } catch (error) {
            logger.log('error', '[AgendaSettings] Export failed', error);
            setStatusMessage({ type: 'error', text: 'Error during export' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleImportData = async () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;

            setIsLoading(true);
            try {
                const text = await file.text();
                const result = await importAgendaData(text, false);
                setStatusMessage({
                    type: 'success',
                    text: `Imported ${result.eventsImported} events and ${result.notesImported} notes.`,
                });
                loadStats();
                triggerHaptic();
            } catch (error) {
                logger.log('error', '[AgendaSettings] Import failed', error);
                setStatusMessage({ type: 'error', text: 'Error during import' });
            } finally {
                setIsLoading(false);
            }
        };
        input.click();
    };

    const handleClearData = async () => {
        if (!confirm('Are you sure you want to delete all agenda data? This action cannot be undone.')) {
            return;
        }

        setIsLoading(true);
        try {
            await clearAllAgendaData();
            setStats({ eventCount: 0, noteCount: 0 });
            setStatusMessage({ type: 'success', text: 'Agenda data cleared.' });
            triggerHaptic('HEAVY');
        } catch (error) {
            logger.log('error', '[AgendaSettings] Clear failed', error);
            setStatusMessage({ type: 'error', text: 'Error during deletion' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleSystemCalendarToggle = async () => {
        if (!settings.showSystemCalendar) {
            // Enabling - need to check/request permissions
            if (!hasSystemCalendarPermission) {
                const granted = await requestSystemCalendarPermissions();
                if (!granted) {
                    setStatusMessage({ type: 'error', text: 'Calendar permissions denied' });
                    return;
                }
                setHasSystemCalendarPermission(true);
            }
        }

        onSettingsChange({
            ...settings,
            showSystemCalendar: !settings.showSystemCalendar,
        });
        triggerHaptic();
    };

    const handleDefaultViewChange = (view: 'month' | 'day') => {
        onSettingsChange({
            ...settings,
            defaultView: view,
        });
        triggerHaptic();
    };

    return (
        <div className="p-6 space-y-8">
            {/* Header */}
            <div>
                <h2 className="text-xl font-bold text-white mb-2">📅 Agenda</h2>
                <p className="text-text-secondary text-sm">
                    Gestisci il tuo calendario e le tue note personali.
                </p>
            </div>

            {/* Stats */}
            {stats && (
                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-surface p-4 rounded-lg border border-white/10">
                        <div className="text-2xl font-bold text-primary">{stats.eventCount}</div>
                        <div className="text-sm text-text-secondary">Events saved</div>
                    </div>
                    <div className="bg-surface p-4 rounded-lg border border-white/10">
                        <div className="text-2xl font-bold text-yellow-400">{stats.noteCount}</div>
                        <div className="text-sm text-text-secondary">Notes saved</div>
                    </div>
                </div>
            )}

            {/* Status Message */}
            {statusMessage && (
                <div
                    className={`p-3 rounded-lg text-sm ${statusMessage.type === 'success'
                        ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                        : statusMessage.type === 'error'
                            ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                            : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        }`}
                >
                    {statusMessage.text}
                </div>
            )}

            {/* Default View Setting */}
            <section className="space-y-3">
                <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wide">Vista Predefinita</h3>
                <div className="flex gap-3">
                    <button
                        onClick={() => handleDefaultViewChange('month')}
                        className={`flex-1 py-3 px-4 rounded-lg border transition-colors ${settings.defaultView === 'month'
                            ? 'bg-primary/20 border-primary text-primary'
                            : 'bg-surface border-white/10 text-text-secondary hover:text-white'
                            }`}
                    >
                        📆 Month
                    </button>
                    <button
                        onClick={() => handleDefaultViewChange('day')}
                        className={`flex-1 py-3 px-4 rounded-lg border transition-colors ${settings.defaultView === 'day'
                            ? 'bg-primary/20 border-primary text-primary'
                            : 'bg-surface border-white/10 text-text-secondary hover:text-white'
                            }`}
                    >
                        📋 Day
                    </button>
                </div>
                <p className="text-xs text-text-secondary">
                    Choose the view that opens when you access the Agenda.
                </p>
            </section>

            {/* System Calendar Integration */}
            <section className="space-y-3">
                <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wide">System Calendar</h3>
                <div className="flex items-center justify-between bg-surface p-4 rounded-lg border border-white/10">
                    <div className="flex-1">
                        <div className="font-medium text-white">Show system events</div>
                        <div className="text-sm text-text-secondary">
                            Integrate events from Android calendar.
                        </div>
                    </div>
                    <button
                        onClick={handleSystemCalendarToggle}
                        className={`w-14 h-8 rounded-full transition-colors relative ${settings.showSystemCalendar ? 'bg-primary' : 'bg-gray-600'
                            }`}
                    >
                        <span
                            className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-transform ${settings.showSystemCalendar ? 'left-7' : 'left-1'
                                }`}
                        />
                    </button>
                </div>
                {settings.showSystemCalendar && !hasSystemCalendarPermission && (
                    <p className="text-xs text-yellow-400">
                        ⚠️ Calendar permissions not yet granted. They will be requested when opening the Agenda.
                    </p>
                )}
            </section>

            {/* Import/Export */}
            <section className="space-y-3">
                <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wide">Data Management</h3>
                <div className="space-y-2">
                    <button
                        onClick={handleExportData}
                        disabled={isLoading}
                        className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                    >
                        📤 Export Agenda
                    </button>
                    <button
                        onClick={handleImportData}
                        disabled={isLoading}
                        className="w-full py-3 px-4 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                    >
                        📥 Import Agenda
                    </button>
                    <button
                        onClick={handleClearData}
                        disabled={isLoading}
                        className="w-full py-3 px-4 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                    >
                        🗑️ Delete All Data
                    </button>
                </div>
                <p className="text-xs text-text-secondary">
                    Esporta un backup JSON dei tuoi eventi e note, o importa dati da un backup precedente.
                </p>
            </section>

            {/* Loading Overlay */}
            {isLoading && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
            )}
        </div>
    );
};

export default AgendaSettings;
