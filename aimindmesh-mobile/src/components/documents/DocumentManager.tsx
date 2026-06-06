import React, { useEffect, useState } from 'react';
import { DocumentIngestionService } from '../../services/documents/DocumentIngestionService';
import { getKnowledgeDatabase } from '../../services/database/knowledgeDatabase';
import { workspaceService } from '../../services/workspaces/WorkspaceService';
import { logger } from '../../services/logger';
import { FilePicker } from '@capawesome/capacitor-file-picker';

import { LLMConfig } from '../../types';

interface DocumentManagerProps {
    llmConfig?: LLMConfig;
}

const ingestionService = new DocumentIngestionService();

/**
 * Extract clean filename from encoded path/URI
 */
function getCleanFilename(filename: string): string {
    // Decode URI-encoded characters (%3A, %2F, etc)
    let decoded = decodeURIComponent(filename);
    // Get the last part of any path
    decoded = decoded.split('/').pop() || decoded;
    decoded = decoded.split('\\').pop() || decoded;
    // Remove any remaining path prefix like "primary:Documents"
    decoded = decoded.split(':').pop() || decoded;
    return decoded;
}

export const DocumentManager: React.FC<DocumentManagerProps> = ({ llmConfig }) => {
    const [documents, setDocuments] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [activeWorkspace, setActiveWorkspace] = useState(workspaceService.getActiveWorkspace());
    const [selectedMode, setSelectedMode] = useState<'STANDARD' | 'DEEP'>('STANDARD');
    const [useLocalNeural, setUseLocalNeural] = useState(false);

    const loadDocuments = async () => {
        try {
            await workspaceService.ensureInitialized();
            const db = await getKnowledgeDatabase();
            // Show all docs, but mark if they are in active workspace
            const res = await db.query('SELECT * FROM documents ORDER BY created_at DESC');

            // Also get docs in active workspace
            let workspaceDocIds = new Set<number>();
            if (activeWorkspace) {
                const wsDocs = await workspaceService.getWorkspaceDocuments(activeWorkspace.id);
                workspaceDocIds = new Set(wsDocs.map(d => d.id));
            }

            setDocuments((res.values || []).map(d => ({
                ...d,
                inWorkspace: workspaceDocIds.has(d.id)
            })));
        } catch (e) {
            logger.log('error', 'Failed to load documents', e);
        }
    };

    useEffect(() => {
        loadDocuments();
        // Listen for workspace changes would be better, but polling for now
        const interval = setInterval(async () => {
            await workspaceService.ensureInitialized();
            const current = workspaceService.getActiveWorkspace();
            if (current?.id !== activeWorkspace?.id) {
                setActiveWorkspace(current);
                loadDocuments();
            }
        }, 2000);
        return () => clearInterval(interval);
    }, [activeWorkspace]);

    const handleUpload = async () => {
        try {
            const result = await FilePicker.pickFiles({
                types: ['application/pdf', 'text/plain', 'text/markdown', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
                readData: false
            });

            if (result.files.length > 0) {
                const file = result.files[0];
                // Path handling might need adjustment depending on Capacitor version/platform
                // FilePicker usually returns a web-accessible path or absolute path
                // DocumentIngestionService expects absolute path readable by filesystem.
                // NOTE: Filesystem.readFile might need a specific directory or permission.
                // Assuming we can read from the path provided (or copy it to app cache first).

                // For now, let's try passing the path directly (check if it has file://)
                let path = file.path || '';
                if (!path) {
                    alert('Could not get file path');
                    return;
                }

                setLoading(true);
                const ingestRes = useLocalNeural 
                    ? await ingestionService.ingestHybrid(path, {}, {
                        chunkSize: llmConfig?.ragChunkSize,
                        chunkOverlap: llmConfig?.ragChunkOverlap,
                        chunkingStrategy: llmConfig?.ragChunkingStrategy,
                        embeddingModelId: llmConfig?.embeddingModelId,
                        mode: selectedMode,
                        localNeural: useLocalNeural
                    })
                    : await ingestionService.ingestDocument(path, {}, {
                        chunkSize: llmConfig?.ragChunkSize,
                        chunkOverlap: llmConfig?.ragChunkOverlap,
                        chunkingStrategy: llmConfig?.ragChunkingStrategy,
                        embeddingModelId: llmConfig?.embeddingModelId,
                        mode: selectedMode,
                        localNeural: useLocalNeural
                    });

                if (ingestRes.status === 'indexed') {
                    // If workspace active, add it
                    if (activeWorkspace) {
                        await workspaceService.addDocumentToWorkspace(activeWorkspace.id, ingestRes.id);
                    }
                    await loadDocuments();
                } else {
                    alert('Upload failed: ' + ingestRes.error);
                }
            }
        } catch (e: any) {
            logger.log('error', 'Pick files failed', e);
            // alert('Pick files failed: ' + e.message);
        } finally {
            setLoading(false);
        }
    };

    const toggleWorkspaceLink = async (docId: number, inWorkspace: boolean) => {
        if (!activeWorkspace) return;
        try {
            if (inWorkspace) {
                await workspaceService.removeDocumentFromWorkspace(activeWorkspace.id, docId);
            } else {
                await workspaceService.addDocumentToWorkspace(activeWorkspace.id, docId);
            }
            await loadDocuments();
        } catch (e) {
            console.error(e);
        }
    };

    const deleteDocument = async (docId: number) => {
        if (!confirm('Delete this document and all its chunks?')) return;
        try {
            const db = await getKnowledgeDatabase();
            // Delete chunks first (FK constraint)
            await db.run('DELETE FROM document_chunks WHERE document_id = ?', [docId]);
            // Delete from workspace links
            await db.run('DELETE FROM workspace_documents WHERE document_id = ?', [docId]);
            // Delete document
            await db.run('DELETE FROM documents WHERE id = ?', [docId]);
            await loadDocuments();
        } catch (e) {
            console.error('Failed to delete document', e);
        }
    };

    return (
        <div className="p-4 space-y-4">
            <div className="flex flex-col gap-4">
                <div className="flex justify-between items-center">
                    <h2 className="text-xl font-bold text-text-primary">Documents</h2>
                    <button
                        onClick={handleUpload}
                        disabled={loading}
                        className={`px-4 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50 transition-all ${selectedMode === 'DEEP' ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-500/20 shadow-lg' : 'bg-primary hover:bg-primary-hover'}`}
                    >
                        {loading ? 'Processing...' : (
                            <>
                                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                                <span className="text-white font-bold">{selectedMode === 'DEEP' ? (useLocalNeural ? 'Local Neural Ingest' : 'Deep Upload') : 'Upload'}</span>
                            </>
                        )}
                    </button>
                </div>

                {/* Ingestion Mode Selector */}
                <div className="flex flex-col gap-2">
                    <div className="bg-surface-light dark:bg-surface-dark p-1 rounded-xl border border-white/5 flex gap-1">
                        <button
                            onClick={() => setSelectedMode('STANDARD')}
                            className={`flex-1 flex flex-col items-center py-2 px-3 rounded-lg transition-all ${selectedMode === 'STANDARD' ? 'bg-primary/20 border border-primary/30 shadow-inner' : 'hover:bg-white/5'}`}
                        >
                            <span className={`text-[10px] font-black uppercase tracking-widest ${selectedMode === 'STANDARD' ? 'text-primary' : 'text-muted-foreground'}`}>Standard</span>
                            <span className="text-[8px] text-muted-foreground/60 mt-0.5">Veloce • Basic RAG</span>
                        </button>
                        <button
                            onClick={() => setSelectedMode('DEEP')}
                            className={`flex-1 flex flex-col items-center py-2 px-3 rounded-lg transition-all ${selectedMode === 'DEEP' ? 'bg-indigo-500/20 border border-indigo-400/30 shadow-inner shadow-indigo-500/10' : 'hover:bg-white/5'}`}
                        >
                            <span className={`text-[10px] font-black uppercase tracking-widest ${selectedMode === 'DEEP' ? 'text-indigo-400' : 'text-muted-foreground'}`}>Neural Deep</span>
                            <span className="text-[8px] text-muted-foreground/60 mt-0.5">Lento • Knowledge Graph</span>
                        </button>
                    </div>

                    {selectedMode === 'DEEP' && (
                        <div className="flex items-center justify-between px-2 py-1 bg-indigo-500/5 rounded-lg border border-indigo-500/10">
                            <div className="flex flex-col">
                                <span className="text-[10px] font-bold text-indigo-300">Autonomia Estrazione</span>
                                <span className="text-[8px] text-indigo-300/60">Usa AI locale anziché server</span>
                            </div>
                            <button 
                                onClick={() => setUseLocalNeural(!useLocalNeural)}
                                className={`w-10 h-5 rounded-full relative transition-colors ${useLocalNeural ? 'bg-indigo-600' : 'bg-surface-variant'}`}
                            >
                                <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${useLocalNeural ? 'left-6' : 'left-1'}`} />
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {activeWorkspace && (
                <div className="text-sm text-text-secondary bg-surface-highlight p-2 rounded-lg">
                    Manage documents for workspace: <span className="font-bold text-primary">{activeWorkspace.name}</span>
                </div>
            )}

            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {documents.map(doc => (
                    <div key={doc.id} className="bg-surface-light dark:bg-surface-dark p-3 rounded-lg border border-border flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <div className="text-2xl">
                                {doc.file_type.includes('pdf') ? '📕' :
                                    doc.file_type.includes('doc') ? '📘' : '📄'}
                            </div>
                            <div>
                                <div className="font-medium text-text-primary truncate max-w-[200px]">
                                    {getCleanFilename(doc.title || doc.filename)}
                                </div>
                                <div className="text-xs text-text-secondary">
                                    {new Date(doc.created_at).toLocaleDateString()} • {doc.total_chunks} chunks
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            {activeWorkspace && (
                                <button
                                    onClick={() => toggleWorkspaceLink(doc.id, doc.inWorkspace)}
                                    className={`p-2 rounded-full transition-colors ${doc.inWorkspace ? 'bg-primary/20 text-primary' : 'bg-surface-highlight text-text-secondary hover:bg-surface-variant'}`}
                                    title={doc.inWorkspace ? "Remove from workspace" : "Add to workspace"}
                                >
                                    {doc.inWorkspace ? (
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                    ) : (
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                                    )}
                                </button>
                            )}
                            <button
                                onClick={() => deleteDocument(doc.id)}
                                className="p-2 rounded-full bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
                                title="Delete document"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </button>
                        </div>
                    </div>
                ))}

                {documents.length === 0 && (
                    <div className="text-center py-10 text-text-secondary">
                        No documents found. Upload one to get started.
                    </div>
                )}
            </div>
        </div>
    );
};
