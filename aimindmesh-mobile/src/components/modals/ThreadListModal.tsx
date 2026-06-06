import React, { useState, useEffect, useRef } from 'react';
import { ThreadMetadata, Category } from '../../types/conversationThread';
import {
    getThreadMetadata,
    deleteThread,
    loadCategories,
    saveCategory,
    deleteCategory,
    updateThreadTitle,
    updateThreadCategory,
    exportData,
    importData
} from '../../services/llm/threadManager';
import { CloseIcon, TrashIcon, KebabVerticalIcon, DownloadIcon, PlusCircleIcon } from '../../constants';
import { triggerHaptic } from '../../services/native';

interface ThreadListModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectThread: (threadId: string) => void;
    onNewConversation: () => void;
    activeThreadId: string | null;
}

// Inline Icons
const SearchIcon = ({ className = "w-5 h-5" }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
);

const FolderIcon = ({ className = "w-5 h-5" }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
);

const EditIcon = ({ className = "w-4 h-4" }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
);

const UploadIcon = ({ className = "w-6 h-6" }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
);

const ThreadListModal: React.FC<ThreadListModalProps> = ({
    isOpen,
    onClose,
    onSelectThread,
    onNewConversation,
    activeThreadId
}) => {
    const [threads, setThreads] = useState<ThreadMetadata[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

    // Editing states
    const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState('');

    // Category management
    const [isManagingCategories, setIsManagingCategories] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');

    // Dropdown state
    const [activeDropdownId, setActiveDropdownId] = useState<string | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            refreshData();
        }
    }, [isOpen]);

    const refreshData = () => {
        setThreads(getThreadMetadata());
        setCategories(loadCategories());
    };

    const handleExport = () => {
        const data = exportData();
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target?.result as string;
            if (importData(content)) {
                refreshData();
                alert('Import successful');
            } else {
                alert('Import failed');
            }
        };
        reader.readAsText(file);
        // Reset input
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleAddCategory = () => {
        if (!newCategoryName.trim()) return;
        saveCategory({
            id: Date.now().toString(),
            name: newCategoryName.trim()
        });
        setNewCategoryName('');
        refreshData();
    };

    const handleDeleteCategory = (id: string) => {
        if (window.confirm('Delete this category? Threads will be uncategorized.')) {
            deleteCategory(id);
            if (selectedCategoryId === id) setSelectedCategoryId(null);
            refreshData();
        }
    };

    const handleSelectThread = (threadId: string) => {
        triggerHaptic();
        onSelectThread(threadId);
        onClose();
    };

    const handleStartRename = (thread: ThreadMetadata) => {
        setEditingThreadId(thread.id);
        setEditTitle(thread.title);
        setActiveDropdownId(null);
    };

    const handleSaveRename = () => {
        if (editingThreadId && editTitle.trim()) {
            updateThreadTitle(editingThreadId, editTitle.trim());
            setEditingThreadId(null);
            refreshData();
        }
    };

    const handleMoveToCategory = (threadId: string, categoryId: string | undefined) => {
        updateThreadCategory(threadId, categoryId);
        setActiveDropdownId(null);
        refreshData();
    };

    const handleDelete = (threadId: string) => {
        if (window.confirm('Delete this conversation? This cannot be undone.')) {
            triggerHaptic('MEDIUM');
            deleteThread(threadId);
            refreshData();
        }
    };

    const filteredThreads = threads.filter(t => {
        const matchesSearch = t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            t.preview.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory = selectedCategoryId ? t.categoryId === selectedCategoryId : true;
        return matchesSearch && matchesCategory;
    });

    const formatDate = (date: Date): string => {
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays} days ago`;

        return date.toLocaleDateString();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div
                className="bg-background rounded-lg shadow-xl w-full max-w-4xl relative flex flex-col border border-white/10 overflow-hidden"
                style={{ height: '90vh', maxHeight: '800px' }}
            >
                {/* Header */}
                <header className="p-4 border-b border-surface flex justify-between items-center bg-surface/20">
                    <div className="flex items-center gap-4">
                        <h2 className="text-xl font-bold text-primary">Conversations</h2>
                        <div className="flex gap-2">
                            <button onClick={handleExport} className="p-2 hover:bg-white/10 rounded-full text-text-secondary" title="Export Backup">
                                <DownloadIcon className="w-5 h-5" />
                            </button>
                            <button onClick={handleImportClick} className="p-2 hover:bg-white/10 rounded-full text-text-secondary" title="Import Backup">
                                <UploadIcon className="w-5 h-5" />
                            </button>
                            <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden"
                                accept=".json"
                                onChange={handleImportFile}
                            />
                        </div>
                    </div>
                    <button
                        onClick={() => { onClose(); triggerHaptic(); }}
                        className="text-gray-400 hover:text-white"
                    >
                        <CloseIcon />
                    </button>
                </header>

                <div className="flex flex-1 overflow-hidden">
                    {/* Sidebar (Categories) */}
                    <aside className="w-64 border-r border-surface bg-surface/10 flex flex-col hidden md:flex">
                        <div className="p-4 border-b border-surface">
                            <button
                                onClick={() => {
                                    onNewConversation();
                                    onClose();
                                }}
                                className="w-full py-2 px-4 bg-primary hover:bg-primary/80 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 text-sm"
                            >
                                <PlusCircleIcon className="w-5 h-5" />
                                New Chat
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-2 space-y-1">
                            <button
                                onClick={() => setSelectedCategoryId(null)}
                                className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 ${selectedCategoryId === null ? 'bg-primary/20 text-primary' : 'text-text-secondary hover:bg-white/5'
                                    }`}
                            >
                                <FolderIcon className="w-4 h-4" />
                                All Chats
                            </button>

                            {categories.map(cat => (
                                <div key={cat.id} className="group flex items-center">
                                    <button
                                        onClick={() => setSelectedCategoryId(cat.id)}
                                        className={`flex-1 text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 ${selectedCategoryId === cat.id ? 'bg-primary/20 text-primary' : 'text-text-secondary hover:bg-white/5'
                                            }`}
                                    >
                                        <span className="w-2 h-2 rounded-full bg-blue-400" />
                                        {cat.name}
                                    </button>
                                    {isManagingCategories && (
                                        <button
                                            onClick={() => handleDeleteCategory(cat.id)}
                                            className="p-1 text-red-400 hover:bg-red-500/10 rounded opacity-0 group-hover:opacity-100"
                                        >
                                            <TrashIcon className="w-3 h-3" />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>

                        <div className="p-3 border-t border-surface">
                            {isManagingCategories ? (
                                <div className="space-y-2">
                                    <input
                                        type="text"
                                        value={newCategoryName}
                                        onChange={(e) => setNewCategoryName(e.target.value)}
                                        placeholder="Category name..."
                                        className="w-full bg-black/20 border border-white/10 rounded px-2 py-1 text-sm text-white"
                                        autoFocus
                                        onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                                    />
                                    <div className="flex gap-2">
                                        <button
                                            onClick={handleAddCategory}
                                            className="flex-1 bg-primary/20 text-primary text-xs py-1 rounded hover:bg-primary/30"
                                        >
                                            Add
                                        </button>
                                        <button
                                            onClick={() => setIsManagingCategories(false)}
                                            className="flex-1 bg-white/5 text-text-secondary text-xs py-1 rounded hover:bg-white/10"
                                        >
                                            Done
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    onClick={() => setIsManagingCategories(true)}
                                    className="w-full text-xs text-text-secondary hover:text-primary flex items-center justify-center gap-1 py-2"
                                >
                                    Manage Categories
                                </button>
                            )}
                        </div>
                    </aside>

                    {/* Main Content */}
                    <main className="flex-1 flex flex-col min-w-0">
                        {/* Search Bar */}
                        <div className="p-4 border-b border-surface">
                            <div className="relative">
                                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary w-5 h-5" />
                                <input
                                    type="text"
                                    placeholder="Search conversations..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full bg-surface/30 border border-white/10 rounded-lg pl-10 pr-4 py-2 text-white placeholder-text-secondary focus:outline-none focus:border-primary/50"
                                />
                            </div>
                        </div>

                        {/* Thread List */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                            {filteredThreads.length === 0 ? (
                                <div className="text-center text-text-secondary text-sm mt-10 opacity-50">
                                    <p>No conversations found</p>
                                </div>
                            ) : (
                                filteredThreads.map((thread) => (
                                    <div
                                        key={thread.id}
                                        className={`group relative p-4 rounded-lg border transition-all ${activeThreadId === thread.id
                                            ? 'bg-primary/10 border-primary/40'
                                            : 'bg-surface/30 border-white/5 hover:border-primary/20 hover:bg-surface/50'
                                            }`}
                                    >
                                        <div
                                            className="cursor-pointer"
                                            onClick={() => {
                                                if (editingThreadId !== thread.id) {
                                                    handleSelectThread(thread.id);
                                                }
                                            }}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        {editingThreadId === thread.id ? (
                                                            <div className="flex items-center gap-2 flex-1" onClick={e => e.stopPropagation()}>
                                                                <input
                                                                    type="text"
                                                                    value={editTitle}
                                                                    onChange={(e) => setEditTitle(e.target.value)}
                                                                    className="flex-1 bg-black/40 border border-primary/50 rounded px-2 py-1 text-sm text-white"
                                                                    autoFocus
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === 'Enter') handleSaveRename();
                                                                        if (e.key === 'Escape') setEditingThreadId(null);
                                                                    }}
                                                                />
                                                                <button onClick={handleSaveRename} className="text-primary text-xs hover:underline">Save</button>
                                                                <button onClick={() => setEditingThreadId(null)} className="text-text-secondary text-xs hover:underline">Cancel</button>
                                                            </div>
                                                        ) : (
                                                            <>
                                                                <h3 className="font-medium text-text-primary truncate">
                                                                    {thread.title}
                                                                </h3>
                                                                {activeThreadId === thread.id && (
                                                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30 flex-shrink-0">
                                                                        Active
                                                                    </span>
                                                                )}
                                                                {thread.categoryId && (
                                                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface/50 text-text-secondary border border-white/10 flex-shrink-0">
                                                                        {categories.find(c => c.id === thread.categoryId)?.name}
                                                                    </span>
                                                                )}
                                                            </>
                                                        )}
                                                    </div>
                                                    <p className="text-sm text-text-secondary line-clamp-2 mb-2">
                                                        {thread.preview}
                                                    </p>
                                                    <div className="flex items-center gap-3 text-xs text-text-secondary/70">
                                                        <span>{formatDate(thread.updatedAt)}</span>
                                                        <span>•</span>
                                                        <span>{thread.messageCount} messages</span>
                                                    </div>
                                                </div>

                                                {/* Actions Menu */}
                                                <div className="relative" onClick={e => e.stopPropagation()}>
                                                    <button
                                                        onClick={() => setActiveDropdownId(activeDropdownId === thread.id ? null : thread.id)}
                                                        className="p-2 text-text-secondary hover:text-white hover:bg-white/10 rounded-full transition-colors"
                                                    >
                                                        <KebabVerticalIcon className="w-5 h-5" />
                                                    </button>

                                                    {activeDropdownId === thread.id && (
                                                        <div className="absolute right-0 top-full mt-1 w-48 bg-surface border border-white/10 rounded-lg shadow-xl z-10 py-1">
                                                            <button
                                                                onClick={() => handleStartRename(thread)}
                                                                className="w-full text-left px-4 py-2 text-sm text-text-primary hover:bg-white/10 flex items-center gap-2"
                                                            >
                                                                <EditIcon className="w-4 h-4" /> Rename
                                                            </button>

                                                            <div className="border-t border-white/5 my-1" />
                                                            <div className="px-4 py-1 text-xs text-text-secondary uppercase font-bold">Move to...</div>
                                                            <button
                                                                onClick={() => handleMoveToCategory(thread.id, undefined)}
                                                                className="w-full text-left px-4 py-2 text-sm text-text-primary hover:bg-white/10"
                                                            >
                                                                Uncategorized
                                                            </button>
                                                            {categories.map(cat => (
                                                                <button
                                                                    key={cat.id}
                                                                    onClick={() => handleMoveToCategory(thread.id, cat.id)}
                                                                    className="w-full text-left px-4 py-2 text-sm text-text-primary hover:bg-white/10"
                                                                >
                                                                    {cat.name}
                                                                </button>
                                                            ))}

                                                            <div className="border-t border-white/5 my-1" />
                                                            <button
                                                                onClick={() => handleDelete(thread.id)}
                                                                className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 flex items-center gap-2"
                                                            >
                                                                <TrashIcon className="w-4 h-4" /> Delete
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </main>
                </div>
            </div>
            {/* Overlay to close dropdowns */}
            {activeDropdownId && (
                <div
                    className="fixed inset-0 z-0"
                    onClick={() => setActiveDropdownId(null)}
                />
            )}
        </div>
    );
};

export default ThreadListModal;
