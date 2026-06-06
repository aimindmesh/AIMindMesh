import { useEffect, useState, useRef } from 'react';
import { Upload, Link, Trash2, StopCircle, PlayCircle, RefreshCw, FileText, CheckCircle2, XCircle, Clock, Loader } from 'lucide-react';
import { useIngestionStore } from '../store/ingestionStore';
import { IngestionJob } from '../services/api';

const STATUS_ICON = {
  DONE:        <CheckCircle2 size={14} className="text-success" />,
  ERROR:       <XCircle size={14} className="text-error" />,
  SKIPPED:     <XCircle size={14} className="text-warning" />,
  CANCELLED:   <XCircle size={14} className="text-muted-foreground" />,
  PENDING:     <Clock size={14} className="text-muted-foreground" />,
  EXTRACTING:  <Loader size={14} className="text-primary animate-spin" />,
  CHUNKING:    <Loader size={14} className="text-primary animate-spin" />,
  VECTORIZING: <Loader size={14} className="text-primary animate-spin" />,
  INDEXING:    <Loader size={14} className="text-primary animate-spin" />,
};

function JobCard({ job, onDelete }: { job: IngestionJob; onDelete: () => void }) {
  const isActive = ['EXTRACTING','CHUNKING','VECTORIZING','INDEXING'].includes(job.status);
  return (
    <div className="p-4 bg-surface/80 rounded-2xl border border-border/50 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {STATUS_ICON[job.status as keyof typeof STATUS_ICON] || <Clock size={14} />}
          <p className="text-xs font-black truncate">{job.source?.split('/').pop() || job.source}</p>
        </div>
        <button onClick={onDelete} className="shrink-0 p-1.5 rounded-lg bg-error/10 active:scale-90 transition-all">
          <Trash2 size={12} className="text-error" />
        </button>
      </div>
      {isActive && (
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${job.progress || 0}%` }} />
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className={`text-[9px] font-black uppercase tracking-widest ${
          job.status === 'DONE' ? 'text-success' :
          job.status === 'ERROR' ? 'text-error' : 'text-muted-foreground'
        }`}>{job.status}</span>
        {job.totalChunks > 0 && (
          <span className="text-[9px] font-mono text-muted-foreground">{job.doneChunks}/{job.totalChunks} chunks</span>
        )}
      </div>
      {job.error && <p className="text-[9px] text-error font-mono leading-tight">{job.error}</p>}
    </div>
  );
}

export default function IngestionView() {
  const { jobs, isLoading, isUploading, fetchJobs, fetchDocuments, ingestUrl, deleteJob, stop, stopAndClear, restart } = useIngestionStore();
  const [urlInput, setUrlInput] = useState('');
  const [tab, setTab] = useState<'jobs' | 'docs'>('jobs');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const { documents } = useIngestionStore();

  const startPolling = () => {
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = setTimeout(async () => { await fetchJobs(); startPolling(); }, 10000);
  };

  useEffect(() => {
    fetchJobs();
    fetchDocuments();
    startPolling();
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, []);

  const handleUrlIngest = async () => {
    if (!urlInput.trim()) return;
    await ingestUrl(urlInput.trim());
    setUrlInput('');
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const { uploadFile } = useIngestionStore.getState();
    await uploadFile(file);
    e.target.value = '';
  };

  const activeCount = jobs.filter(j => ['EXTRACTING','CHUNKING','VECTORIZING','INDEXING','PENDING'].includes(j.status)).length;

  return (
    <div className="view-content flex flex-col h-full !overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-border/50 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-lg font-black tracking-tighter italic">INGESTION HUB</h1>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
              {jobs.length} jobs · {activeCount} active
            </p>
          </div>
          <button onClick={() => { fetchJobs(); fetchDocuments(); }} className="p-2.5 rounded-xl bg-surface border border-border active:scale-90 transition-all">
            <RefreshCw size={14} className={`text-primary ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Upload Controls */}
        <div className="flex gap-2 mb-3">
          <button onClick={() => fileInputRef.current?.click()} className="btn-primary flex-1" disabled={isUploading}>
            <Upload size={14} />
            {isUploading ? 'Uploading...' : 'Upload File'}
          </button>
          <input ref={fileInputRef} type="file" accept=".pdf,.txt,.md,.docx" className="hidden" onChange={handleFileChange} />
        </div>

        <div className="flex gap-2">
          <input
            type="url"
            placeholder="https://... or paste URL"
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            className="flex-1 bg-input border border-border rounded-2xl px-4 py-2.5 text-xs font-mono outline-none focus:border-primary transition-colors"
          />
          <button onClick={handleUrlIngest} disabled={!urlInput.trim()} className="btn-primary px-4 disabled:opacity-30">
            <Link size={14} />
          </button>
        </div>
      </div>

      {/* Flow Controls */}
      {activeCount > 0 && (
        <div className="flex gap-2 px-4 py-3 border-b border-border/30 shrink-0">
          <button onClick={stop} className="btn-ghost flex-1 text-[9px]">
            <StopCircle size={12} /> Stop
          </button>
          <button onClick={stopAndClear} className="btn-danger flex-1 text-[9px]">
            <Trash2 size={12} /> Stop & Clear
          </button>
          <button onClick={restart} className="btn-ghost flex-1 text-[9px]">
            <PlayCircle size={12} /> Restart
          </button>
        </div>
      )}

      {/* Tab Switch */}
      <div className="flex gap-1 px-4 py-2 border-b border-border/30 shrink-0">
        {(['jobs', 'docs'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${tab === t ? 'bg-primary/20 text-primary' : 'text-muted-foreground'}`}
          >
            {t === 'jobs' ? `Jobs (${jobs.length})` : `Documents (${documents.length})`}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2" style={{ WebkitOverflowScrolling: 'touch' }}>
        {tab === 'jobs' ? (
          jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full opacity-30 gap-2">
              <FileText size={36} />
              <p className="text-xs font-black uppercase tracking-widest">Queue Empty</p>
            </div>
          ) : (
            jobs.slice(0, 50).map(job => (
              <JobCard key={job.id} job={job} onDelete={() => deleteJob(job.id)} />
            ))
          )
        ) : (
          documents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full opacity-30 gap-2">
              <FileText size={36} />
              <p className="text-xs font-black uppercase tracking-widest">No Documents</p>
            </div>
          ) : (
            documents.map(doc => (
              <div key={doc.id} className="p-4 bg-surface/80 rounded-2xl border border-border/50 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-black truncate">{doc.title}</p>
                  <p className="text-[9px] text-muted-foreground mt-0.5">{doc.chunkCount} chunks · {doc.mimeType}</p>
                </div>
                <button onClick={() => useIngestionStore.getState().deleteDocument(doc.id)} className="p-2 rounded-xl bg-error/10 active:scale-90 transition-all shrink-0">
                  <Trash2 size={12} className="text-error" />
                </button>
              </div>
            ))
          )
        )}
      </div>
    </div>
  );
}
