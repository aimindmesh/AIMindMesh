import React, { useEffect, useState, useRef } from 'react';
import { workspaceService, ContextMode } from '../../services/workspaces/WorkspaceService';
import { Workspace } from '../../types/workspace';
import { logger } from '../../services/logger';

interface WorkspaceSelectorProps {
    onWorkspaceChanged?: (workspace: Workspace) => void;
    className?: string;
}

export const WorkspaceSelector: React.FC<WorkspaceSelectorProps> = ({ onWorkspaceChanged, className = '' }) => {
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
    const [mode, setMode] = useState<ContextMode>('GLOBAL');
    const [isOpen, setIsOpen] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const [newWorkspaceName, setNewWorkspaceName] = useState('');

    const dropdownRef = useRef<HTMLDivElement>(null);

    const loadWorkspaces = async () => {
        try {
            await workspaceService.ensureInitialized();
            const list = await workspaceService.listWorkspaces();
            const active = workspaceService.getActiveWorkspace();
            const currentMode = workspaceService.getContextMode();
            setWorkspaces(list);
            setActiveWorkspace(active);
            setMode(currentMode);
        } catch (e) {
            logger.log('error', 'Failed to load workspaces', e);
        }
    };

    useEffect(() => {
        loadWorkspaces();
        // Poll for changes (simple way to sync if service doesn't have React context)
        const interval = setInterval(loadWorkspaces, 5000);
        return () => clearInterval(interval);
    }, []);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setShowCreate(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSwitch = async (id: number) => {
        await workspaceService.switchWorkspace(id);
        await loadWorkspaces();
        setIsOpen(false);
        if (onWorkspaceChanged) {
            const newActive = workspaceService.getActiveWorkspace();
            if (newActive) onWorkspaceChanged(newActive);
        }
    };

    const handleCreate = async () => {
        if (!newWorkspaceName.trim()) return;
        try {
            await workspaceService.createWorkspace({ name: newWorkspaceName });
            await loadWorkspaces();
            setNewWorkspaceName('');
            setShowCreate(false);
        } catch (e) {
            alert('Failed to create workspace');
        }
    };

    return (
        <div className={`relative ${className}`} ref={dropdownRef}>
            {/* Trigger Button */}
            <div className="flex items-center gap-1 bg-surface-light dark:bg-surface-dark border border-border/50 p-0.5 pr-2 shadow-sm rounded-full">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="flex items-center gap-2 pl-2 rounded-full hover:bg-surface-highlight transition-colors"
                >
                    <span className="text-lg">
                        {mode === 'WORKSPACE' && activeWorkspace ? activeWorkspace.icon :
                            mode === 'GLOBAL' ? '🌍' : '🚫'}
                    </span>
                    <span className="text-sm font-medium text-text-primary inline-block max-w-[150px] truncate">
                        {mode === 'WORKSPACE' && activeWorkspace ? activeWorkspace.name :
                            mode === 'GLOBAL' ? 'Global Context' : 'No Workspace'}
                    </span>
                    <svg className={`w-4 h-4 text-text-secondary transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </button>

                {mode !== 'NONE' && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            workspaceService.disableContext().then(loadWorkspaces);
                            setIsOpen(false);
                        }}
                        className="ml-1 p-1 hover:bg-white/20 rounded-full text-text-secondary hover:text-text-primary transition-colors"
                        title="Disable context (No Workspace)"
                    >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                )}
            </div>

            {/* Dropdown Menu */}
            {isOpen && (
                <div className={`absolute top-full mt-2 w-72 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden ${className.includes('justify-center') || className.includes('items-center') ? 'left-1/2 -translate-x-1/2' : 'right-0'
                    }`}>
                    <div className="p-2">
                        <div className="text-xs font-bold text-text-secondary uppercase px-2 py-1 mb-1">
                            Select Workspace
                        </div>

                        <div className="max-h-60 overflow-y-auto space-y-1">
                            {/* Global Option */}
                            <button
                                onClick={() => {
                                    workspaceService.setGlobalContext().then(loadWorkspaces);
                                    setIsOpen(false);
                                }}
                                className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-3 transition-colors ${mode === 'GLOBAL' ? 'bg-primary/10 text-primary' : 'hover:bg-surface-highlight text-text-primary'}`}
                            >
                                <div className="w-8 h-8 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center">🌍</div>
                                <div>
                                    <div className="font-medium">Global Context</div>
                                    <div className="text-xs text-text-secondary">Search all knowledge</div>
                                </div>
                                {mode === 'GLOBAL' && <div className="ml-auto w-2 h-2 rounded-full bg-primary" />}
                            </button>

                            {/* No Workspace Option */}
                            <button
                                onClick={() => {
                                    workspaceService.disableContext().then(loadWorkspaces);
                                    setIsOpen(false);
                                }}
                                className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-3 transition-colors ${mode === 'NONE' ? 'bg-primary/10 text-primary' : 'hover:bg-surface-highlight text-text-primary'}`}
                            >
                                <div className="w-8 h-8 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center">🚫</div>
                                <div>
                                    <div className="font-medium">No Workspace</div>
                                    <div className="text-xs text-text-secondary">Disable RAG / Context</div>
                                </div>
                                {mode === 'NONE' && <div className="ml-auto w-2 h-2 rounded-full bg-primary" />}
                            </button>

                            {workspaces.map(ws => (
                                <button
                                    key={ws.id}
                                    onClick={() => handleSwitch(ws.id)}
                                    className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-3 transition-colors ${activeWorkspace?.id === ws.id ? 'bg-primary/10 text-primary' : 'hover:bg-surface-highlight text-text-primary'}`}
                                >
                                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-lg" style={{ backgroundColor: ws.color + '20', color: ws.color }}>
                                        {ws.icon}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium truncate">{ws.name}</div>
                                        <div className="text-xs text-text-secondary flex gap-2">
                                            <span>{ws.document_count || 0} docs</span>
                                            {ws.last_used && <span>• {new Date(ws.last_used).toLocaleDateString()}</span>}
                                        </div>
                                    </div>
                                    {activeWorkspace?.id === ws.id && (
                                        <div className="w-2 h-2 rounded-full bg-primary" />
                                    )}
                                </button>
                            ))}
                        </div>

                        <div className="h-px bg-border my-2" />

                        {/* Create New */}
                        {showCreate ? (
                            <div className="px-2 pb-1">
                                <input
                                    autoFocus
                                    type="text"
                                    placeholder="Workspace Name..."
                                    className="w-full px-3 py-2 rounded-lg bg-input border border-border text-text-primary text-sm mb-2 focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
                                    value={newWorkspaceName}
                                    onChange={e => setNewWorkspaceName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleCreate()}
                                />
                                <div className="flex gap-2 text-xs">
                                    <button
                                        onClick={handleCreate}
                                        className="flex-1 bg-primary text-white py-1.5 rounded-md hover:bg-primary-hover font-medium"
                                    >
                                        Create
                                    </button>
                                    <button
                                        onClick={() => setShowCreate(false)}
                                        className="flex-1 bg-surface-highlight text-text-secondary py-1.5 rounded-md hover:bg-surface-variant font-medium"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button
                                onClick={() => setShowCreate(true)}
                                className="w-full text-left px-3 py-2 rounded-lg flex items-center gap-3 hover:bg-surface-highlight text-primary group"
                            >
                                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-colors">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                    </svg>
                                </div>
                                <span className="font-medium">New Workspace</span>
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
