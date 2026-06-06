import React, { useState, useEffect } from 'react';
import { fileManagerService, AppFile, FILE_DIRECTORIES } from '../../../services/file/fileManagerService';
import { logger } from '../../../services/logger';
import { triggerHaptic } from '../../../services/native';

interface FileStorageManagerProps {
    onClose: () => void;
}

const TABS = [
    { id: 'all', label: 'All Files', dir: null },
    { id: 'vosk', label: 'Vosk/STT', dir: FILE_DIRECTORIES.VOSK },
    { id: 'whisper', label: 'Whisper', dir: FILE_DIRECTORIES.WHISPER },
    { id: 'wakeword', label: 'Wake Word', dir: FILE_DIRECTORIES.WAKEWORD },
    { id: 'piper', label: 'Piper Voices', dir: FILE_DIRECTORIES.PIPER },
    { id: 'models', label: 'Native Models', dir: FILE_DIRECTORIES.MODELS },
    { id: 'vad', label: 'VAD', dir: FILE_DIRECTORIES.VAD },
];

export const FileStorageManager: React.FC<FileStorageManagerProps> = ({ onClose }) => {
    const [activeTab, setActiveTab] = useState('all');
    const [files, setFiles] = useState<AppFile[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [renamingFile, setRenamingFile] = useState<AppFile | null>(null);
    const [newFileName, setNewFileName] = useState('');
    const [currentPath, setCurrentPath] = useState<string | null>(null);

    useEffect(() => {
        setCurrentPath(null); // Reset path when switching tabs
        loadFiles();
    }, [activeTab]);

    useEffect(() => {
        loadFiles();
    }, [currentPath]);

    const loadFiles = async () => {
        setIsLoading(true);
        try {
            let loadedFiles: AppFile[] = [];
            const tab = TABS.find(t => t.id === activeTab);

            if (currentPath) {
                // If we are navigating inside a directory
                loadedFiles = await fileManagerService.listFiles(currentPath);
            } else if (activeTab === 'all') {
                loadedFiles = await fileManagerService.listAllFiles();
            } else if (tab && tab.dir) {
                loadedFiles = await fileManagerService.listFiles(tab.dir);
            }

            setFiles(loadedFiles);
        } catch (error) {
            logger.log('error', 'Failed to load files', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDelete = async (file: AppFile) => {
        if (!window.confirm(`Are you sure you want to delete ${file.name}?`)) return;

        triggerHaptic();
        try {
            await fileManagerService.deleteFile(file.path);
            setFiles(files.filter(f => f.path !== file.path));
        } catch (error) {
            alert('Failed to delete file');
        }
    };

    const handleRename = async () => {
        if (!renamingFile || !newFileName.trim()) return;

        triggerHaptic();
        try {
            await fileManagerService.renameFile(renamingFile.category, renamingFile.name, newFileName.trim());
            await loadFiles();
            setRenamingFile(null);
            setNewFileName('');
        } catch (error) {
            alert('Failed to rename file');
        }
    };

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const handleDirectoryClick = (file: AppFile) => {
        setCurrentPath(file.path);
    };

    const handleBackClick = () => {
        if (!currentPath) return;

        // Check if we are at the root of a tab category
        const tab = TABS.find(t => t.id === activeTab);
        if (tab && tab.dir && currentPath === tab.dir) {
            setCurrentPath(null);
            return;
        }

        // Go up one level
        // Since paths are like 'vosk-models/en-us/...', we split by '/'
        // Ideally we should preserve the relative root of the active tab, but for simplicity:
        // If currentPath doesn't contain '/', we are at root?
        const parts = currentPath.split('/');
        if (parts.length <= 1) {
            setCurrentPath(null);
        } else {
            parts.pop(); // Remove last segment

            // Check if adding the popped segment back brings us to one of the root directories 
            // If we are in 'all' tab, we might have started at 'vosk-models' directly from root list
            const parentPath = parts.join('/');

            // If the parent path matches one of the known root directories, and we are in 'all' tab, 
            // we should probably go back to the 'all' list (null path) IF we navigated INTO it from listAllFiles.
            // BUT, listAllFiles returns items with path='vosk-models/file1'. 
            // Wait, listAllFiles returns flattened list of files inside directories?
            // Let's check fileManagerService.listAllFiles() implementation.
            // It calls listFiles(dir) for each dir. listFiles returns relative path?
            // 'path' in AppFile is `${categoryDirectory}/${file.name}`. So it is e.g. 'vosk-models/model1'.
            // So if we are at 'vosk-models/model1', parent is 'vosk-models'.
            // If we are in 'all' tab, 'vosk-models' IS a folder in logical sense but listAllFiles flattens its content?
            // Actually listAllFiles iterates dirs and pushes all files. 
            // It seems it does NOT list the directories themselves as entries in the root list.
            // It lists contents of all known dirs.
            // So if I am in 'all' tab, I see files like 'vosk-models/model.zip'.
            // If I click a directory inside 'vosk-models', say 'vosk-models/subdir', currentPath becomes 'vosk-models/subdir'.
            // Back should go to 'vosk-models'.
            // But 'vosk-models' is not explicitly 'null'.
            // If currentPath becomes one of the FILE_DIRECTORIES values, and we click back...
            // If activeTab is 'all', showing 'vosk-models' content means we are just showing filtered view?
            // No, if activeTab is 'all', we show everything.
            // If we are deep in 'vosk-models/subdir', parent is 'vosk-models'.
            // If we set currentPath='vosk-models', loadFiles will call listFiles('vosk-models'), showing only vosk files.
            // This effectively switches view from 'All' to 'Vosk' content strictly.
            // To return to 'All' combined view, we must set currentPath to null.

            // Heuristic: If the new path is one of the root directories, AND we are in 'all' tab, go to null.
            const isRoot = Object.values(FILE_DIRECTORIES).includes(parentPath);
            if (activeTab === 'all' && isRoot) {
                setCurrentPath(null);
            } else {
                // Also check if we are going UP past the root of the current tab
                if (tab && tab.dir && parentPath.length < tab.dir.length) {
                    setCurrentPath(null);
                } else {
                    setCurrentPath(parentPath);
                }
            }
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-surface border border-white/10 rounded-xl w-full max-w-4xl h-[80vh] flex flex-col shadow-2xl animate-fade-in">

                {/* Header */}
                <div className="p-4 border-b border-white/10 flex items-center justify-between bg-white/5">
                    <h2 className="text-xl font-semibold text-text-primary flex items-center gap-2">
                        <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
                        </svg>
                        File Storage Manager
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/10 rounded-full transition-colors text-text-secondary"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex overflow-x-auto p-2 gap-2 border-b border-white/10 scrollbar-hide">
                    {/* Back Button / Breadcrumb area when navigating */}
                    {currentPath ? (
                        <div className="flex items-center gap-2 px-2 w-full">
                            <button
                                onClick={handleBackClick}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-sm font-medium transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                </svg>
                                Back
                            </button>
                            <span className="text-sm text-text-secondary truncate ml-2">
                                /{currentPath}
                            </span>
                        </div>
                    ) : (
                        TABS.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${activeTab === tab.id
                                    ? 'bg-primary/20 text-primary border border-primary/30'
                                    : 'text-text-secondary hover:bg-white/5 border border-transparent'
                                    }`}
                            >
                                {tab.label}
                            </button>
                        ))
                    )}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                    {isLoading ? (
                        <div className="flex items-center justify-center h-full text-text-secondary">
                            <span className="animate-pulse">Loading files...</span>
                        </div>
                    ) : files.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-text-secondary opacity-50">
                            <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                            </svg>
                            <p>No files found in this category</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {files.map((file, idx) => (
                                <div key={idx} className="group bg-surface/50 p-3 rounded-lg border border-white/5 hover:border-primary/30 transition-all flex items-center gap-3">
                                    <div className="p-2 bg-white/5 rounded-lg text-primary">
                                        {file.type === 'directory' ? (
                                            <button onClick={() => handleDirectoryClick(file)} className="text-primary hover:text-primary-light transition-colors">
                                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                                </svg>
                                            </button>
                                        ) : (
                                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                            </svg>
                                        )}
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        {renamingFile?.path === file.path ? (
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="text"
                                                    value={newFileName}
                                                    onChange={e => setNewFileName(e.target.value)}
                                                    className="w-full bg-input border border-primary/50 rounded px-2 py-1 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                                    autoFocus
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') handleRename();
                                                        if (e.key === 'Escape') setRenamingFile(null);
                                                    }}
                                                />
                                                <button onClick={handleRename} className="text-green-400 hover:text-green-300">
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                    </svg>
                                                </button>
                                                <button onClick={() => setRenamingFile(null)} className="text-red-400 hover:text-red-300">
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                    </svg>
                                                </button>
                                            </div>
                                        ) : (
                                            <>
                                                <h4
                                                    className={`text-sm font-medium truncate cursor-pointer ${file.type === 'directory' ? 'text-primary hover:underline' : 'text-text-primary'}`}
                                                    title={file.name}
                                                    onClick={() => file.type === 'directory' && handleDirectoryClick(file)}
                                                >
                                                    {file.name}
                                                </h4>
                                                <div className="flex items-center gap-2 text-xs text-text-secondary mt-0.5">
                                                    <span>{formatSize(file.size)}</span>
                                                    <span className="w-1 h-1 rounded-full bg-white/20" />
                                                    <span className="opacity-70">{file.category.split('/').pop()}</span>
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={() => {
                                                setRenamingFile(file);
                                                setNewFileName(file.name);
                                            }}
                                            className="p-1.5 hover:bg-white/10 rounded text-blue-400 hover:text-blue-300 transition-colors"
                                            title="Rename"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                            </svg>
                                        </button>
                                        <button
                                            onClick={() => handleDelete(file)}
                                            className="p-1.5 hover:bg-white/10 rounded text-red-400 hover:text-red-300 transition-colors"
                                            title="Delete"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
