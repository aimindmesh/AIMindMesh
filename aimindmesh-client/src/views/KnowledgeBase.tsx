import { useEffect, useState } from 'react';
import { serverApi } from '../services/serverApi';
import { Database, FileText, Upload, Trash2, AlertCircle, CheckCircle2, Clock, Activity, RefreshCw, Search, BrainCircuit, ChevronLeft, ChevronRight } from 'lucide-react';
import { Logger } from '../utils/logger';
import { useKnowledgeStore, UploadJob } from '../store/knowledgeStore';
import DocumentViewerModal from '../components/kg/DocumentViewerModal';
import EngineControlPanel from '../components/kg/EngineControlPanel';
import { extractConceptsLocally } from '../utils/conceptExtractor';

export default function KnowledgeBase() {
  const { 
    documents, 
    uploadJobs, 
    loading, 
    isUploading, 
    isSyncing, 
    fetchDocuments, 
    pollJob, 
    setIsUploading, 
    deleteDocument,
    deleteDocuments
  } = useKnowledgeStore();
  // Local UI States (Safe to lose on unmount)
  const [uploadUrl, setUploadUrl] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'FILE' | 'URL'>('ALL');
  const [extractionMode, setExtractionMode] = useState<'STANDARD' | 'DEEP'>('STANDARD');
  const [useLocalNeural, setUseLocalNeural] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<any | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    fetchDocuments();
  }, []);

  // Reset pagination when filter criteria change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filterType, pageSize]);

  const handleDeleteDoc = async (id: string) => {
    Logger.debug('KnowledgeBase', `User prompted for document deletion: ${id}`);
    if (!confirm('Are you sure you want to delete this document?')) {
      return;
    }
    try {
      await deleteDocument(id);
      const next = new Set(selectedIds);
      next.delete(id);
      setSelectedIds(next);
    } catch (err) {
      alert('Deletion failed.');
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} documents?`)) return;
    try {
      await deleteDocuments(Array.from(selectedIds));
      setSelectedIds(new Set());
    } catch (err) {
      alert('Batch deletion failed.');
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredDocs.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredDocs.map(d => d.id)));
  };

  const handleURLIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadUrl) {
      Logger.debug('KnowledgeBase', 'URL ingestion attempted with empty source');
      return;
    }
    Logger.info('KnowledgeBase', `Initiating synaptic scrape for URL: ${uploadUrl} (Mode: ${extractionMode})`);
    try {
      const res = await serverApi.post('/api/documents/ingest/url', { url: uploadUrl, mode: extractionMode });
      setUploadUrl('');
      pollJob(res.data.jobId);
    } catch (err) {
      Logger.error('KnowledgeBase', `Failed to initiate URL ingestion for ${uploadUrl}`, err);
    }
  };

  const handleFileUpload = async (files: FileList | File[]) => {
    if (!files || files.length === 0) {
      Logger.debug('KnowledgeBase', 'File upload triggered but no kinetic input detected (0 files)');
      return;
    }
    setIsUploading(true);
    const fileArray = Array.from(files);
    Logger.info('KnowledgeBase', `Starting upload for ${fileArray.length} files (Mode: ${extractionMode})`);
    try {
      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        Logger.info('KnowledgeBase', `Uploading synaptic source: ${file.name} (${file.type}, ${file.size} bytes)`);
        
        // Handle Local Extraction for Text/MD files if requested
        let localConcepts: string[] = [];
        if (useLocalNeural && extractionMode === 'DEEP' && (file.name.endsWith('.txt') || file.name.endsWith('.md'))) {
            Logger.info('KnowledgeBase', `[LocalNeural] Extracting concepts from ${file.name} locally...`);
            const content = await file.text();
            localConcepts = await extractConceptsLocally(content);
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('mode', extractionMode);

        const res = await serverApi.post('/api/documents/ingest/file', formData, {
          onUploadProgress: (progressEvent: any) => {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / (progressEvent.total || 1));
            Logger.info('KnowledgeBase', `Transfer pulse [${file.name}]: ${percentCompleted}% (${progressEvent.loaded}/${progressEvent.total} bytes)`);
          }
        });

        if (res.data.jobId) {
          Logger.info('KnowledgeBase', `Server acknowledging ingest job: ${res.data.jobId} for ${file.name}`);
          pollJob(res.data.jobId);
          
          // If we have local concepts, we'll sync them after the job is (theoretically) close to starting
          if (localConcepts.length > 0) {
              Logger.info('KnowledgeBase', `[LocalNeural] Synchronizing ${localConcepts.length} concepts for job ${res.data.jobId}`);
              try {
                  await serverApi.post(`/api/documents/${res.data.jobId}/sync-concepts`, { concepts: localConcepts });
                  Logger.info('KnowledgeBase', `[LocalNeural] Concept sync initiated for ${file.name}`);
              } catch (syncErr) {
                  Logger.warn('KnowledgeBase', `[LocalNeural] Concept sync failed for ${file.name}: ${syncErr}`);
              }
          }
        } else {
          Logger.warn('KnowledgeBase', `Neural reject: Server did not provide a jobId for ${file.name}`);
          alert(`No jobId returned for file: ${file.name}`);
        }
      }
    } catch (err: any) {
      Logger.error('KnowledgeBase', 'File ingest pipeline failure', err);
      alert('Upload failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsUploading(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    Logger.debug('KnowledgeBase', 'Neural drop event detected');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isDragging) {
      Logger.debug('KnowledgeBase', 'Drag-over detected: system awaiting drop');
      setIsDragging(true);
    }
  };

  const onDragLeave = () => {
    Logger.debug('KnowledgeBase', 'Drag-leave detected: clearing drop indicator');
    setIsDragging(false);
  };

  const renderStatus = (job: UploadJob) => {
    switch (job.status) {
      case 'DONE':
        return <span className="flex items-center gap-1.5 text-success font-bold text-[10px] uppercase bg-success/10 px-2 py-1 rounded-md border border-success/20"><CheckCircle2 className="w-3 h-3" /> Indexed</span>;
      case 'ERROR':
        return <span className="flex items-center gap-1.5 text-error font-bold text-[10px] uppercase bg-error/10 px-2 py-1 rounded-md border border-error/20"><AlertCircle className="w-3 h-3" /> Failed</span>;
      case 'EXTRACTING':
        return <span className="flex items-center gap-1.5 text-primary font-bold text-[10px] uppercase bg-primary/10 px-2 py-1 rounded-md border border-primary/20"><FileText className="w-3 h-3 animate-pulse" /> Extracting</span>;
      case 'VECTORIZING':
        return <span className="flex items-center gap-1.5 text-secondary font-bold text-[10px] uppercase bg-secondary/10 px-2 py-1 rounded-md border border-secondary/20"><BrainCircuit className="w-3 h-3 animate-pulse" /> Vectorizing</span>;
      case 'INDEXING':
        return <span className="flex items-center gap-1.5 text-warning font-bold text-[10px] uppercase bg-warning/10 px-2 py-1 rounded-md border border-warning/20"><Database className="w-3 h-3 animate-pulse" /> Indexing</span>;
      default:
        return <span className="flex items-center gap-1.5 text-muted-foreground font-bold text-[10px] uppercase bg-surface/50 px-2 py-1 rounded-md border border-border"><Clock className="w-3 h-3" /> {job.status}</span>;
    }
  };

  const filteredDocs = documents.filter(doc => {
    const matchesSearch = doc.title.toLowerCase().includes(searchQuery.toLowerCase()) || (doc.url && doc.url.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesType = filterType === 'ALL' || (filterType === 'FILE' && !doc.url) || (filterType === 'URL' && !!doc.url);
    return matchesSearch && matchesType;
  });

  // Calculate pagination boundaries
  const totalPages = Math.ceil(filteredDocs.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedDocs = filteredDocs.slice(startIndex, startIndex + pageSize);

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, currentPage + 2);

    if (start > 1) {
      pages.push(1);
      if (start > 2) pages.push('...');
    }

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    if (end < totalPages) {
      if (end < totalPages - 1) pages.push('...');
      pages.push(totalPages);
    }

    return pages;
  };

  if (loading && documents.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-full text-muted-foreground opacity-70">
        <Activity className="w-12 h-12 mb-4 animate-pulse opacity-50" />
        <p className="text-lg">Indexing Knowledge Base...</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 h-full flex flex-col gap-6 animate-fade-in max-w-[1400px] mx-auto w-full overflow-y-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Database className="w-8 h-8 text-primary" />
            Knowledge Management
          </h1>
          <p className="text-muted-foreground text-sm flex items-center gap-2 mt-1">
            <Activity className="w-4 h-4" /> Cognitive Repository for RAG Vector Search
          </p>
        </div>
        <button onClick={fetchDocuments} className="text-sm font-bold px-4 py-2 rounded-xl bg-surface border border-white/5 hover:bg-surface-hover transition-all flex items-center gap-2 shadow-lg active:scale-95">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh Index
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        <div className="xl:col-span-3 flex flex-col gap-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 glass-panel p-4 rounded-2xl border-white/5">
            <div className="flex items-center gap-3 w-full md:w-auto">
              <div className="relative flex-1 md:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search by name or source..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full bg-background/50 border border-border pl-10 pr-4 py-2 rounded-xl text-sm outline-none focus:border-primary/50 transition-all"
                />
              </div>
              <select
                value={filterType}
                onChange={e => setFilterType(e.target.value as any)}
                className="bg-background/50 border border-border px-3 py-2 rounded-xl text-xs font-bold uppercase outline-none focus:border-primary/50"
              >
                <option value="ALL">All Types</option>
                <option value="FILE">Files Only</option>
                <option value="URL">URLs Only</option>
              </select>
            </div>
            <div className="flex items-center gap-4">
              {selectedIds.size > 0 && (
                <button 
                  onClick={handleBatchDelete}
                  className="text-[10px] font-black uppercase tracking-widest px-4 py-2 bg-error/10 text-error border border-error/20 rounded-xl hover:bg-error/20 transition-all"
                >
                  Delete Selected ({selectedIds.size})
                </button>
              )}
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest px-4">
                {filteredDocs.length} Documents Indexed
              </div>
            </div>
          </div>

          {/* STREAM CONTROL SECTION (Consolidated from Admin) */}
          <EngineControlPanel onPurgeComplete={() => setSelectedIds(new Set())} />

          <div className="glass-panel p-6 rounded-2xl min-h-[600px] border-white/5 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-[80px] -z-10" />
            
            {filteredDocs.length === 0 ? (
              isSyncing ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-20 px-6 text-center">
                  <Activity className="w-12 h-12 mb-4 animate-pulse text-primary opacity-50" />
                  <p className="text-lg font-medium">Synchronizing neural sources...</p>
                  <p className="text-sm opacity-60 mt-2 italic">Awaiting Knowledge Graph synchronization...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-20 px-6 text-center border-2 border-dashed border-border rounded-xl">
                  <FileText className="w-12 h-12 mb-4 opacity-30" />
                  <p>Knowledge Base is currently empty.</p>
                  <p className="text-sm opacity-60 mt-2">Upload files or paste URLs to index them into the Graph.</p>
                </div>
              )
            ) : (
              <>
                <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border/50 text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="pb-3 w-10">
                        <input 
                          type="checkbox" 
                          checked={selectedIds.size === filteredDocs.length && filteredDocs.length > 0}
                          onChange={toggleSelectAll}
                          className="rounded border-border bg-background text-primary focus:ring-primary shadow-sm"
                        />
                      </th>
                      <th className="pb-3 font-semibold">Title/Source</th>
                      <th className="pb-3 font-semibold">Ingested On</th>
                      <th className="pb-3 font-semibold">Nodes</th>
                      <th className="pb-3 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {paginatedDocs.map(doc => (
                      <tr key={doc.id} className={`hover:bg-surface-hover/80 transition-colors border-b border-border/20 group ${selectedIds.has(doc.id) ? 'bg-primary/10' : ''}`}>
                        <td className="py-4">
                          <input 
                            type="checkbox" 
                            checked={selectedIds.has(doc.id)}
                            onChange={() => toggleSelect(doc.id)}
                            className="rounded border-border bg-background text-primary focus:ring-primary shadow-sm"
                          />
                        </td>
                        <td className="py-4 font-medium max-w-[300px] truncate" title={doc.title || doc.url}>
                          <div className="flex flex-col">
                            <span className="text-slate-100">{doc.title || doc.id}</span>
                            <span className="text-[10px] text-muted-foreground font-mono truncate opacity-60">ID: {doc.id}</span>
                          </div>
                        </td>
                        <td className="py-4 text-sm text-muted-foreground font-mono">
                          {doc.date ? new Date(doc.date).toLocaleString() : 'N/A'}
                        </td>
                        <td className="py-4 text-sm">
                          <span className="bg-primary/10 text-primary border border-primary/20 px-2.5 py-1 rounded-md font-mono font-bold text-xs">
                             {doc.nodeCount || doc.chunkCount || 0}
                          </span>
                        </td>
                        <td className="py-4 text-right">
                          <div className="flex justify-end gap-2">
                             {doc.url && (
                               <a href={doc.url} target="_blank" rel="noreferrer" className="p-2 text-primary/60 hover:text-primary hover:bg-primary/10 rounded-lg transition-all" title="View Source URL">
                                 <Activity size={16} />
                               </a>
                             )}
                             <button 
                               onClick={async (e) => {
                                 e.stopPropagation();
                                 try {
                                   Logger.debug('KnowledgeBase', `Attempting neural fetch for chunks of doc: ${doc.id}`);
                                   const res = await serverApi.get(`/api/documents/${doc.id}/chunks`);
                                   if (!res.data.chunks || res.data.chunks.length === 0) {
                                      alert("There are no extracted fragments for this document. It might still be processing.");
                                   } else {
                                      setSelectedDoc({ ...doc, chunks: res.data.chunks });
                                   }
                                 } catch (err) {
                                   alert("Error loading document from server.");
                                   Logger.error('KnowledgeBase', `Failed to load chunks for ${doc.id}`, err);
                                 }
                               }} 
                               className="p-2 text-primary hover:bg-primary/20 bg-primary/10 rounded-lg transition-all border border-primary/20" 
                               title="View Extracted Content"
                             >
                               <FileText size={16} />
                             </button>
                             <button onClick={() => handleDeleteDoc(doc.id)} className="p-2 text-muted-foreground hover:bg-error/10 hover:text-error rounded-lg transition-all opacity-0 group-hover:opacity-100" title="Delete from Database">
                               <Trash2 size={16} />
                             </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* PAGINATION CONTROLS */}
              {filteredDocs.length > 0 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 pt-4 border-t border-border/30 text-sm">
                  <div className="text-xs text-muted-foreground font-bold uppercase tracking-wider">
                    Showing {Math.min(startIndex + 1, filteredDocs.length)} to {Math.min(startIndex + pageSize, filteredDocs.length)} of {filteredDocs.length} documents
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Show:</span>
                      <select
                        value={pageSize}
                        onChange={e => {
                          setPageSize(Number(e.target.value));
                          setCurrentPage(1);
                        }}
                        className="bg-background border border-border px-2.5 py-1 rounded-xl text-xs font-bold outline-none focus:border-primary/50 transition-all cursor-pointer"
                      >
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                        <option value={200}>200</option>
                      </select>
                    </div>

                    {totalPages > 1 && (
                      <div className="flex items-center gap-1 bg-background/50 border border-border p-1 rounded-xl">
                        <button
                          onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                          disabled={currentPage === 1}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-hover disabled:opacity-30 disabled:pointer-events-none transition-all"
                          title="Previous Page"
                        >
                          <ChevronLeft size={16} />
                        </button>
                        
                        {getPageNumbers().map((p, idx) => (
                          <button
                            key={idx}
                            onClick={() => typeof p === 'number' && setCurrentPage(p)}
                            disabled={p === '...'}
                            className={`min-w-8 h-8 px-2 rounded-lg text-xs font-bold transition-all ${p === currentPage ? 'bg-primary text-surface shadow-md font-extrabold' : p === '...' ? 'cursor-default opacity-50' : 'text-muted-foreground hover:text-foreground hover:bg-surface-hover'}`}
                          >
                            {p}
                          </button>
                        ))}

                        <button
                          onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                          disabled={currentPage === totalPages}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-hover disabled:opacity-30 disabled:pointer-events-none transition-all"
                          title="Next Page"
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Upload className="w-5 h-5 text-muted-foreground" /> Ingest Pipeline
            </h2>

            {uploadJobs.length > 0 || isUploading ? (
              <div className="space-y-4">
                {isUploading && (
                  <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 flex flex-col gap-2 items-center text-center animate-fade-in">
                    <Upload className="w-8 h-8 text-primary animate-bounce mb-1" />
                    <p className="text-xs font-bold uppercase text-primary tracking-wider">Preparing Synaptic Transfer...</p>
                    <div className="w-full h-1 bg-border rounded-full overflow-hidden">
                       <div className="h-full bg-primary animate-pulse w-full rounded-full" />
                    </div>
                  </div>
                )}
                {uploadJobs.map(job => (
                  <div key={job.id} className={`glass-panel p-4 rounded-xl border flex flex-col gap-2 ${job.status === 'ERROR' ? 'border-error/30 bg-error/5' : 'border-primary/30 bg-primary/5'}`}>
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 font-mono">
                        {renderStatus(job)}
                      </span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${job.status === 'ERROR' ? 'bg-error/20 text-error' : 'bg-primary/20 text-primary'}`}>{job.status}</span>
                    </div>
                    {job.status !== 'ERROR' && (
                      <div className="w-full bg-surface-hover rounded-full h-1.5 overflow-hidden">
                        <div className="bg-primary h-full transition-all duration-500" style={{ width: `${job.progress}%` }} />
                      </div>
                    )}
                    {job.error && (
                      <p className="text-[10px] text-error font-medium leading-relaxed bg-error/10 p-2 rounded border border-error/10">Error: {job.error}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="glass-panel p-6 rounded-2xl flex flex-col gap-6 border-white/5 shadow-xl">
              <div className="flex flex-col gap-3">
                <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground border-b border-border pb-2 mb-1 flex items-center gap-2">
                  <Activity size={12} className="text-primary" /> Extraction Parameters
                </label>
                <div className="grid grid-cols-2 gap-2 p-1 bg-background/50 rounded-xl border border-border">
                   <button 
                     onClick={() => setExtractionMode('STANDARD')}
                     className={`py-2 rounded-lg text-xs font-bold transition-all ${extractionMode === 'STANDARD' ? 'bg-primary text-surface shadow-lg' : 'text-muted-foreground hover:text-foreground'}`}
                   >STANDARD</button>
                   <button 
                     onClick={() => setExtractionMode('DEEP')}
                     className={`py-2 rounded-lg text-xs font-bold transition-all ${extractionMode === 'DEEP' ? 'bg-primary text-surface shadow-lg' : 'text-muted-foreground hover:text-foreground'}`}
                   >DEEP</button>
                </div>
                <p className="text-[10px] text-muted-foreground opacity-60 px-1 leading-relaxed">
                  {extractionMode === 'STANDARD' ? 'Focus on text extraction and vectorization.' : 'Extract deep semantic relationships and cross-references.'}
                </p>

                {extractionMode === 'DEEP' && (
                    <div className="flex items-center justify-between p-3 bg-indigo-500/5 rounded-xl border border-indigo-500/20 group hover:bg-indigo-500/10 transition-all">
                        <div className="flex flex-col">
                            <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-widest">Extraction Autonomy</span>
                            <span className="text-[8px] text-indigo-300/60 font-medium">The PC app will extract concepts before sending them</span>
                        </div>
                        <button 
                            type="button"
                            onClick={() => setUseLocalNeural(!useLocalNeural)}
                            className={`w-10 h-5 rounded-full relative transition-all duration-300 ${useLocalNeural ? 'bg-indigo-600 shadow-[0_0_10px_rgba(79,70,229,0.5)]' : 'bg-surface-hover'}`}
                        >
                            <div className={`absolute top-1 w-3 h-3 bg-white rounded-full shadow-sm transition-all duration-300 ${useLocalNeural ? 'left-6' : 'left-1'}`} />
                        </button>
                    </div>
                )}
              </div>

              <form onSubmit={handleURLIngest} className="flex flex-col gap-3">
                <label className="text-sm font-semibold text-foreground">Scrape URL</label>
                <div className="flex gap-2">
                  <input
                    type="url" required placeholder="https://..."
                    value={uploadUrl} onChange={e => setUploadUrl(e.target.value)}
                    className="flex-1 bg-background border border-border p-3 rounded-xl outline-none focus:border-primary text-sm shadow-inner"
                  />
                  <button type="submit" className="bg-primary text-surface px-4 rounded-xl flex items-center font-bold shadow hover:bg-primary-hover transition-colors">Add</button>
                </div>
              </form>

              <div className="flex items-center gap-4 py-2">
                <div className="h-px bg-border flex-1" />
                <span className="text-xs text-muted-foreground font-semibold uppercase">Or Upload File</span>
                <div className="h-px bg-border flex-1" />
              </div>

              <div
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                className={`relative group cursor-pointer border-2 border-dashed rounded-2xl p-8 transition-all text-center flex flex-col items-center ${isDragging ? 'border-primary bg-primary/10 shadow-lg scale-[1.02]' : 'border-border hover:border-primary bg-background/50 hover:bg-primary/5'}`}
              >
                <input
                  type="file" multiple
                  accept=".pdf,.txt,.md,.docx"
                  onClick={() => Logger.debug('KnowledgeBase', 'File selection dialog manually opened via click')}
                  onChange={(e) => {
                    const selectedFiles = e.target.files;
                    if (selectedFiles) {
                      Logger.debug('KnowledgeBase', `File input change detected: ${selectedFiles.length} files in buffer`);
                      handleFileUpload(selectedFiles);
                      e.target.value = ''; // Reset input
                    } else {
                      Logger.debug('KnowledgeBase', 'File input change detected but no files found in selection event');
                    }
                  }}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                />
                <Upload className={`w-8 h-8 mb-3 transition-colors ${isDragging ? 'text-primary' : 'text-muted-foreground group-hover:text-primary'}`} />
                <p className={`font-bold text-sm ${isDragging ? 'text-primary' : ''}`}>{isDragging ? 'Drop here to upload' : 'Drop file or click to browse'}</p>
                <p className="text-xs text-muted-foreground mt-1">PDF, DOCX, TXT, MD</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* DOCUMENT VIEWER MODAL */}
      <DocumentViewerModal selectedDoc={selectedDoc} onClose={() => setSelectedDoc(null)} />
    </div>
  );
}
