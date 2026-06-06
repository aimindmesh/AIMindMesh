import { useEffect, useState } from 'react';
import { Database, Download, Trash2, RotateCcw, ShieldCheck, AlertCircle, Clock, Save } from 'lucide-react';
import { adminApi } from '../../services/serverApi';
import { Logger } from '../../utils/logger';

export function BackupManagement() {
  const [backups, setBackups] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isRestoring, setIsRestoring] = useState<string | null>(null);

  const fetchBackups = async () => {
    setIsLoading(true);
    try {
      const res = await adminApi.getBackups();
      setBackups(res.data.backups || []);
    } catch (err) {
      Logger.error('Backup', 'Failed to fetch backups');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBackups();
  }, []);

  const handleCreateBackup = async () => {
    setIsCreating(true);
    try {
      await adminApi.createBackup();
      await fetchBackups();
    } catch (err) {
      Logger.error('Backup', 'Failed to create backup');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteBackup = async (filename: string) => {
    if (!window.confirm(`Are you sure you want to delete ${filename}?`)) return;
    try {
      await adminApi.deleteBackup(filename);
      await fetchBackups();
    } catch (err) {
      Logger.error('Backup', 'Failed to delete backup');
    }
  };

  const handleRestoreBackup = async (filename: string) => {
    if (!window.confirm(`DANGER: This will overwrite your current server data with the contents of ${filename}. The server state will be reset. Continue?`)) return;
    
    setIsRestoring(filename);
    try {
      await adminApi.restoreBackup(filename);
      alert('Restore successful. You should restart the server container manually if it does not auto-restart.');
    } catch (err: any) {
      alert(`Restore failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setIsRestoring(null);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div className="flex flex-col gap-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-5">
          <div className="p-4 bg-primary/10 rounded-2xl border border-primary/20">
            <Database className="w-8 h-8 text-primary shadow-glow-sm" />
          </div>
          <div>
            <h2 className="text-3xl font-black tracking-tighter italic">RECOVERY HUB</h2>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-[0.2em] opacity-60">Full server snapshots & disaster recovery</p>
          </div>
        </div>

        <button
          onClick={handleCreateBackup}
          disabled={isCreating}
          className="flex items-center gap-3 px-8 py-4 bg-primary text-white rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] hover:bg-primary-hover hover:-translate-y-1 transition-all disabled:opacity-50 shadow-2xl shadow-primary/20 active:scale-95"
        >
          {isCreating ? <RotateCcw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {isCreating ? 'Creating Snapshot...' : 'Create New Snapshot'}
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* INFO CARD */}
        <div className="glass-panel rounded-[32px] p-8 border border-white/5 flex flex-col gap-6 shadow-2xl">
          <div className="flex items-center gap-3 opacity-60">
            <ShieldCheck size={16} className="text-success" />
            <span className="text-[10px] font-black uppercase tracking-widest">Security Protocol</span>
          </div>
          
          <div className="flex flex-col gap-2">
            <h3 className="text-lg font-black italic tracking-tight text-foreground">Snapshot Coverage</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Backups include the full SQLite database (operational data, history, logs), 
              the core <code className="bg-white/5 px-1 rounded text-primary">config.json</code>, 
              and all synchronized media assets. 
            </p>
          </div>

          <div className="p-5 bg-warning/5 border border-warning/20 rounded-2xl flex gap-4">
            <AlertCircle className="w-5 h-5 text-warning shrink-0" />
            <p className="text-[11px] text-warning font-medium leading-relaxed uppercase tracking-tight">
              Restore operations are destructive. Always create a manual snapshot before reverting to an older state.
            </p>
          </div>
        </div>

        {/* BACKUP LIST */}
        <div className="xl:col-span-2 glass-panel rounded-[32px] border border-white/5 overflow-hidden shadow-2xl">
          <div className="bg-white/5 p-6 border-b border-white/5 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <Clock size={16} className="text-primary opacity-60" />
              <span className="text-[10px] font-black uppercase tracking-[0.25em]">Version History</span>
            </div>
            <button onClick={fetchBackups} className="text-[10px] font-black uppercase tracking-widest text-primary hover:opacity-100 opacity-60 transition-opacity">Refresh List</button>
          </div>

          <div className="max-h-[600px] overflow-y-auto custom-scrollbar">
            {isLoading ? (
              <div className="p-20 flex flex-col items-center justify-center gap-4 opacity-40">
                <RotateCcw className="w-10 h-10 animate-spin text-primary" />
                <span className="text-[10px] font-black uppercase tracking-widest">Synchronizing Registry...</span>
              </div>
            ) : backups.length === 0 ? (
              <div className="p-20 flex flex-col items-center justify-center gap-4 opacity-40">
                <Database className="w-10 h-10" />
                <span className="text-[10px] font-black uppercase tracking-widest">No Snapshots Found</span>
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-surface/80 backdrop-blur-md z-10">
                  <tr className="border-b border-white/5">
                    <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest opacity-40">Snapshot Name</th>
                    <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest opacity-40">Size</th>
                    <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest opacity-40">Created At</th>
                    <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest opacity-40 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {backups.map(backup => (
                    <tr key={backup.filename} className="hover:bg-white/5 transition-colors group">
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                            <Database size={16} className="text-primary opacity-60 group-hover:opacity-100" />
                          </div>
                          <span className="text-xs font-bold font-mono tracking-tight">{backup.filename}</span>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <span className="text-[11px] font-black font-mono opacity-60">{formatSize(backup.size)}</span>
                      </td>
                      <td className="px-8 py-6">
                        <span className="text-[11px] font-bold opacity-40">{formatDate(backup.createdAt)}</span>
                      </td>
                      <td className="px-8 py-6 text-right">
                        <div className="flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                          <a 
                            href={adminApi.getBackupDownloadUrl(backup.filename)}
                            download={backup.filename}
                            className="p-2.5 bg-white/5 hover:bg-success/20 text-success rounded-lg transition-all"
                            title="Download to Local PC"
                          >
                            <Download size={14} />
                          </a>
                          <button 
                            onClick={() => handleRestoreBackup(backup.filename)}
                            disabled={!!isRestoring}
                            className="p-2.5 bg-white/5 hover:bg-warning/20 text-warning rounded-lg transition-all"
                            title="Restore Server State"
                          >
                            {isRestoring === backup.filename ? <RotateCcw size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                          </button>
                          <button 
                            onClick={() => handleDeleteBackup(backup.filename)}
                            className="p-2.5 bg-white/5 hover:bg-error/20 text-error rounded-lg transition-all"
                            title="Permanent Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
