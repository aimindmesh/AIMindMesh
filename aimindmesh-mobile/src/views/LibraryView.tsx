import React, { useState, useEffect, useCallback } from 'react';
import { AIMindMeshServerSettings } from '../types';
import { fetchArchives, deleteArchive, fetchArchiveArtifact } from '../services/feedService';
import { Share } from '@capacitor/share';
import { Clipboard } from '@capacitor/clipboard';
import ReactMarkdown from 'react-markdown';
import { triggerHaptic } from '../services/native';

interface Props {
  serverSettings: AIMindMeshServerSettings | undefined;
}

const LibraryView: React.FC<Props> = ({ serverSettings }) => {
  const [archives, setArchives] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedExec, setSelectedExec] = useState<any | null>(null);
  const [artifactContent, setArtifactContent] = useState<string | null>(null);
  const [loadingArtifact, setLoadingArtifact] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadArchives = useCallback(async () => {
    if (!serverSettings?.enabled) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchArchives(serverSettings, 100);
      setArchives(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [serverSettings]);

  useEffect(() => {
    loadArchives();
  }, [loadArchives]);

  const handleSelect = async (exec: any) => {
    setSelectedExec(exec);
    if (exec.artifact_path || exec.artifactPath) {
      setLoadingArtifact(true);
      try {
        const content = await fetchArchiveArtifact(serverSettings!, exec.task_id || exec.taskId, exec.execution_id || exec.executionId);
        setArtifactContent(content);
      } catch (e: any) {
        setArtifactContent('Failed to load artifact: ' + e.message);
      } finally {
        setLoadingArtifact(false);
      }
    } else {
      setArtifactContent('No artifact generated for this execution.');
    }
  };

  const handleBack = () => {
    setSelectedExec(null);
    setArtifactContent(null);
  };

  const handleDelete = async (exec: any, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Permanently delete this artifact?')) return;
    if (!serverSettings) return;
    try {
      const execId = exec.execution_id || exec.executionId;
      await deleteArchive(serverSettings, execId);
      setArchives(prev => prev.filter(x => (x.execution_id || x.executionId) !== execId));
      triggerHaptic('MEDIUM');
    } catch (err: any) {
      alert('Delete failed: ' + err.message);
    }
  };

  const handleShare = async () => {
    if (!artifactContent || !selectedExec) return;
    try {
      await Share.share({
        title: 'AI Task Artifact',
        text: artifactContent,
        dialogTitle: 'Share Artifact'
      });
    } catch (e) {
      // Fallback or ignore
    }
  };

  const handleCopy = async () => {
    if (!artifactContent) return;
    await Clipboard.write({ string: artifactContent });
    triggerHaptic('LIGHT');
  };

  if (selectedExec) {
    return (
      <div className="flex flex-col h-full bg-background animate-fade-in z-50 absolute inset-0">
        <header className="px-5 pt-12 pb-3 flex items-center justify-between border-b border-white/10 shrink-0 bg-surface/90 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <button onClick={handleBack} className="p-2 rounded-full bg-white/10 hover:bg-white/20">
              <span className="text-xl">←</span>
            </button>
            <h1 className="text-lg font-bold truncate pr-4 text-text-primary">
              Artifact Viewer
            </h1>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCopy} className="p-2 text-primary hover:bg-white/10 rounded-full" title="Copy">
              📋
            </button>
            <button onClick={handleShare} className="p-2 text-primary hover:bg-white/10 rounded-full" title="Share via...">
              ↗️
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4 custom-scrollbar">
          {loadingArtifact ? (
            <div className="text-center text-text-secondary mt-10 animate-pulse">Loading artifact...</div>
          ) : (
            <div className="prose prose-invert max-w-none prose-sm marker:text-primary">
              <ReactMarkdown>{artifactContent || ''}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background relative overflow-hidden">
      <header className="px-5 pt-5 pb-3 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-teal-400 to-emerald-400 bg-clip-text text-transparent">
            Library
          </h1>
          <p className="text-xs text-text-secondary mt-0.5">Your saved task artifacts</p>
        </div>
        <button
            onClick={loadArchives}
            disabled={loading}
            className="p-2 rounded-xl bg-surface/80 border border-white/10 hover:border-teal-400/30 transition-all disabled:opacity-40"
        >
            <svg className={`w-4 h-4 text-text-secondary ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
        </button>
      </header>

      {error ? (
        <div className="mx-5 mb-3 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
          {error}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-5 pb-24">
          {archives.length === 0 && !loading ? (
             <div className="flex flex-col items-center justify-center h-full text-center gap-4">
                 <div className="text-5xl opacity-80">🗄️</div>
                 <h2 className="text-xl font-bold text-text-primary">Archive Empty</h2>
                 <p className="text-sm text-text-secondary">AI task outputs will be saved here.</p>
             </div>
          ) : (
             <div className="flex flex-col gap-3 pt-1">
                 {archives.map(exec => {
                    const execId = exec.execution_id || exec.executionId;
                    const taskId = exec.task_id || exec.taskId;
                    const status = exec.status;
                    const isCompleted = status === 'completed';
                    
                    return (
                      <div 
                         key={execId}
                         onClick={() => handleSelect(exec)}
                         className="relative rounded-2xl overflow-hidden border border-white/5 bg-surface/60 p-4 pl-5 cursor-pointer hover:border-teal-400/30 active:scale-[0.99] transition-all"
                      >
                         <div className="flex justify-between items-start gap-4 mb-2">
                            <span className="font-bold text-text-primary text-sm line-clamp-1">{taskId}</span>
                            <button
                               onClick={(e) => handleDelete(exec, e)}
                               className="p-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                               title="Delete"
                            >
                               🗑️
                            </button>
                         </div>
                         <div className="flex items-center gap-3 mt-2">
                            <div className={`text-[10px] px-2 py-0.5 rounded-md uppercase font-bold tracking-widest ${isCompleted ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'}`}>
                              {status}
                            </div>
                            <span className="text-xs text-text-secondary/70">
                               {new Date(exec.started_at || exec.startedAt).toLocaleDateString()}
                            </span>
                         </div>
                      </div>
                    );
                 })}
             </div>
          )}
        </div>
      )}
    </div>
  );
};

export default LibraryView;
