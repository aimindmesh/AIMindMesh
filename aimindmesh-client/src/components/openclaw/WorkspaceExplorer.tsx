import React, { useEffect, useState } from 'react';
import { agentApi } from '../../services/serverApi';

interface WorkspaceFile {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  mtime: string;
}

export const WorkspaceExplorer: React.FC = () => {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [isTextFile, setIsTextFile] = useState(true);
  const [editingSize, setEditingSize] = useState(0);
  const [editorLoading, setEditorLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  
  // Track collapsed state of directories (key is directory path, value is boolean)
  const [collapsedDirs, setCollapsedDirs] = useState<Record<string, boolean>>({});

  const fetchFiles = async () => {
    setLoading(true);
    try {
      const { data } = await agentApi.listWorkspaceFiles();
      // Sort: directories first, then files alphabetically
      const sorted = (data.files || []).sort((a, b) => {
        // We want directory structures to align cleanly. Sorting by path ensures they appear in tree order.
        return a.path.localeCompare(b.path);
      });
      setFiles(sorted);

      // Collapse directories by default, preserving state for already loaded folders on refresh
      setCollapsedDirs(prev => {
        const nextCollapsed = { ...prev };
        (data.files || []).forEach(f => {
          if (f.isDirectory && prev[f.path] === undefined) {
            nextCollapsed[f.path] = true;
          }
        });
        return nextCollapsed;
      });
    } catch (e) {
      console.error('Failed to list workspace files', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  const handleSelectFile = async (filePath: string) => {
    setSelectedFile(filePath);
    setEditorLoading(true);
    setSaved(false);
    try {
      const { data } = await agentApi.getWorkspaceFile(filePath);
      setIsTextFile(data.isText);
      setEditingSize(data.size);
      if (data.isText) {
        setFileContent(data.content || '');
      } else {
        setFileContent('');
      }
    } catch (e) {
      console.error('Failed to read file', e);
      setFileContent('Error loading file contents.');
    } finally {
      setEditorLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedFile || saving) return;
    setSaving(true);
    try {
      await agentApi.saveWorkspaceFile(selectedFile, fileContent);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      fetchFiles(); // refresh sizes/list
    } catch (e) {
      console.error('Failed to save file', e);
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = async (filePath: string, isDirectory: boolean) => {
    try {
      const response = await agentApi.downloadWorkspaceFile(filePath);
      // Axios returns a Blob directly when responseType is 'blob'
      const blob = response.data;
      if (!(blob instanceof Blob)) {
        throw new Error('Server did not return a valid binary blob');
      }

      // Check if we are running in Tauri to use native dialog and filesystem API
      let tauriDialog, tauriFs;
      try {
        tauriDialog = await import('@tauri-apps/plugin-dialog');
        tauriFs = await import('@tauri-apps/plugin-fs');
      } catch (e) {
        // Not in Tauri or plugin not loaded
      }

      if (tauriDialog && tauriFs) {
        const baseName = filePath.split('/').pop() || 'download';
        const defaultPath = isDirectory ? `${baseName}.tar.gz` : baseName;
        const ext = defaultPath.split('.').pop() || '';

        const savePath = await tauriDialog.save({
          defaultPath: defaultPath,
          filters: [{ name: baseName, extensions: [ext] }]
        });

        if (savePath) {
          const arrayBuffer = await blob.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);
          await tauriFs.writeFile(savePath, uint8Array);
        }
      } else {
        // Fallback: Browser downloading via anchor click
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const baseName = filePath.split('/').pop() || 'download';
        link.setAttribute('download', isDirectory ? `${baseName}.tar.gz` : baseName);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
      }
    } catch (e: any) {
      console.error('Failed to download file', e);
      alert(`Download failed: ${e.message || e}`);
    }
  };

  const handleDelete = async (filePath: string) => {
    try {
      await agentApi.deleteWorkspaceFile(filePath);
      if (selectedFile === filePath) {
        setSelectedFile(null);
        setFileContent('');
      }
      setDeletingPath(null);
      fetchFiles();
    } catch (e) {
      console.error('Failed to delete file', e);
    }
  };

  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim()) return;
    try {
      await agentApi.saveWorkspaceFile(newFileName.trim(), '# New File\n');
      setNewFileName('');
      setShowNewFileModal(false);
      fetchFiles();
      handleSelectFile(newFileName.trim());
    } catch (e) {
      console.error('Failed to create file', e);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileIcon = (fileName: string, isDirectory: boolean) => {
    if (isDirectory) return '📁';
    const ext = fileName.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'md': return '📝';
      case 'json': return '⚙️';
      case 'js':
      case 'ts': return '📜';
      case 'py': return '🐍';
      case 'txt': return '📄';
      case 'yaml':
      case 'yml': return '🛠️';
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif': return '🖼️';
      case 'sh': return '🐚';
      default: return '📎';
    }
  };

  const toggleDirectory = (dirPath: string) => {
    setCollapsedDirs(prev => ({
      ...prev,
      [dirPath]: !prev[dirPath]
    }));
  };

  const isVisible = (filePath: string) => {
    const parts = filePath.split('/');
    // Check if any ancestor folder of the item's path is collapsed
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join('/');
      if (collapsedDirs[ancestor]) {
        return false;
      }
    }
    return true;
  };

  const filteredFiles = files.filter(f => {
    // If searching, show all matching files bypassing collapse logic
    if (searchQuery) {
      return f.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
             f.path.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return isVisible(f.path);
  });

  return (
    <div className="flex flex-col gap-6 h-full animate-in zoom-in-95 duration-500">
      {/* Header */}
      <div className="flex justify-between items-end border-b border-border pb-4">
        <div>
          <h3 className="text-xl font-bold tracking-tight">Workspace Files</h3>
          <p className="text-sm text-muted-foreground mt-1">Browse, view, and modify files produced or consumed by the OpenClaw environment.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowNewFileModal(true)}
            className="px-4 py-2 bg-primary text-primary-foreground text-xs font-bold rounded-xl border border-primary/20 hover:shadow-lg hover:shadow-primary/20 transition-all uppercase tracking-wider active:scale-95"
          >
            + New File
          </button>
          <button
            onClick={fetchFiles}
            disabled={loading}
            className="p-2 rounded-xl bg-surface-2 border border-border hover:bg-surface-offset transition-all text-muted-foreground hover:text-foreground disabled:opacity-50"
            title="Refresh files"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={loading ? 'animate-spin' : ''}>
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
              <path d="M21 3v5h-5"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-[500px]">
        {/* Left: File list (4 cols) */}
        <div className="lg:col-span-4 flex flex-col gap-4 bg-surface border border-border rounded-2xl p-4 overflow-hidden shadow-sm">
          {/* Search */}
          <input
            type="text"
            placeholder="Search workspace files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2.5 text-sm bg-surface-2 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/60"
          />

          {/* Files container */}
          <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-1 pr-1">
            {loading ? (
              <div className="flex flex-col items-center justify-center p-8 text-muted-foreground gap-2">
                <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                <span className="text-xs">Scanning workspace...</span>
              </div>
            ) : filteredFiles.length === 0 ? (
              <div className="text-center p-8 text-muted-foreground text-xs">
                No files found in workspace.
              </div>
            ) : (
              filteredFiles.map((file) => {
                const isSelected = selectedFile === file.path;
                const isFolderCollapsed = collapsedDirs[file.path];
                // Calculate folder depth based on slashes in path for tree indentation
                const depth = file.path.split('/').length - 1;
                
                return (
                  <div
                    key={file.path}
                    onClick={() => {
                      if (file.isDirectory) {
                        toggleDirectory(file.path);
                      } else {
                        handleSelectFile(file.path);
                      }
                    }}
                    style={{ paddingLeft: searchQuery ? '12px' : `${depth * 14 + 12}px` }}
                    className={`flex items-center justify-between rounded-xl py-2 pr-3 transition-all group ${
                      file.isDirectory ? 'cursor-pointer hover:bg-surface-offset/80' : 'cursor-pointer'
                    } ${
                      isSelected 
                        ? 'bg-primary/10 border border-primary/20 text-primary' 
                        : 'border border-transparent hover:bg-surface-offset'
                    }`}
                  >
                    <div className="flex items-center gap-2 overflow-hidden flex-1">
                      {/* Dropdown arrow for directories */}
                      {file.isDirectory && !searchQuery ? (
                        <span className="text-[10px] text-muted-foreground/75 font-mono select-none w-3">
                          {isFolderCollapsed ? '▶' : '▼'}
                        </span>
                      ) : (
                        <span className="w-3"></span>
                      )}

                      <span className="text-base select-none">{getFileIcon(file.name, file.isDirectory)}</span>
                      <div className="flex flex-col overflow-hidden">
                        <span className={`text-sm ${file.isDirectory ? 'font-bold text-foreground/90' : 'font-medium'} truncate`}>
                          {file.name}
                        </span>
                      </div>
                    </div>

                    {/* Stats & Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      {!file.isDirectory && (
                        <span className="text-[10px] font-mono text-muted-foreground opacity-60">
                          {formatSize(file.size)}
                        </span>
                      )}
                      
                      {/* Delete confirmation states */}
                      {deletingPath === file.path ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(file.path); }}
                            className="p-1 rounded bg-error/15 text-error hover:bg-error/35 text-[9px] font-bold"
                          >
                            Yes
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeletingPath(null); }}
                            className="p-1 rounded bg-surface-2 text-muted-foreground hover:bg-surface-offset text-[9px] font-bold"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDownload(file.path, file.isDirectory); }}
                            className="p-1 rounded hover:bg-surface-2 text-muted-foreground hover:text-foreground transition-colors"
                            title={file.isDirectory ? "Download folder (.tar.gz)" : "Download file"}
                          >
                            📥
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeletingPath(file.path); }}
                            className="p-1 rounded hover:bg-surface-2 text-error transition-colors"
                            title="Delete"
                          >
                            🗑️
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: File Viewer / Editor (8 cols) */}
        <div className="lg:col-span-8 flex flex-col bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">
          {!selectedFile ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-muted-foreground gap-3">
              <span className="text-4xl">📂</span>
              <div className="flex flex-col gap-1">
                <span className="text-sm font-bold text-foreground">No File Selected</span>
                <span className="text-xs">Select a file from the sidebar to inspect or edit its contents.</span>
              </div>
            </div>
          ) : editorLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-muted-foreground gap-2">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
              <span className="text-xs">Reading file...</span>
            </div>
          ) : !isTextFile ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-muted-foreground gap-4">
              <span className="text-4xl">📎</span>
              <div className="flex flex-col gap-1">
                <span className="text-sm font-bold text-foreground">Binary File Detected</span>
                <span className="text-xs">This file format cannot be viewed inline ({formatSize(editingSize)}).</span>
              </div>
              <button
                onClick={() => handleDownload(selectedFile, false)}
                className="px-6 py-2.5 bg-primary text-primary-foreground text-xs font-bold rounded-xl border border-primary/20 hover:shadow-lg hover:shadow-primary/20 transition-all uppercase tracking-wider active:scale-95"
              >
                Download File
              </button>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden h-full">
              {/* Editor Bar */}
              <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-surface-2/30">
                <div className="flex items-center gap-2 overflow-hidden">
                  <span className="font-mono text-sm font-bold text-foreground truncate">{selectedFile}</span>
                  <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0">({formatSize(editingSize)})</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleSelectFile(selectedFile)}
                    className="p-1.5 rounded-lg border border-border hover:bg-surface-offset text-muted-foreground transition-all"
                    title="Reload file content"
                  >
                    🔄
                  </button>
                  <button
                    onClick={() => handleDownload(selectedFile, false)}
                    className="p-1.5 rounded-lg border border-border hover:bg-surface-offset text-muted-foreground transition-all"
                    title="Download file"
                  >
                    📥
                  </button>
                </div>
              </div>

              {/* Text Area */}
              <textarea
                value={fileContent}
                onChange={(e) => setFileContent(e.target.value)}
                className="flex-1 p-6 font-mono text-xs leading-relaxed bg-surface border-0 focus:ring-0 outline-none resize-none overflow-y-auto custom-scrollbar"
                spellCheck={false}
              />

              {/* Editor Footer */}
              <div className="flex justify-end items-center px-6 py-3 border-t border-border bg-surface-2/30">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className={`rounded-xl px-6 py-2 text-xs font-bold tracking-widest uppercase transition-all shadow-md ${
                    saved 
                    ? 'bg-success text-success-foreground' 
                    : 'bg-primary text-primary-foreground hover:shadow-primary/25 active:scale-95'
                  } disabled:opacity-50`}
                >
                  {saving ? 'SAVING...' : saved ? '✓ SAVED' : 'SAVE FILE'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* New File Modal */}
      {showNewFileModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center animate-fade-in">
          <div className="bg-surface border border-border rounded-2xl w-full max-w-md p-6 flex flex-col gap-4 shadow-2xl">
            <div>
              <h4 className="text-lg font-bold">Create New Workspace File</h4>
              <p className="text-xs text-muted-foreground mt-1">Specify relative file path inside the workspace root.</p>
            </div>
            <form onSubmit={handleCreateFile} className="flex flex-col gap-4">
              <input
                type="text"
                required
                placeholder="e.g. scripts/test.py or README.md"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                className="w-full px-4 py-2.5 text-sm bg-surface-2 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/50"
                autoFocus
              />
              <div className="flex justify-end gap-2 text-xs font-bold tracking-wider uppercase">
                <button
                  type="button"
                  onClick={() => { setShowNewFileModal(false); setNewFileName(''); }}
                  className="px-4 py-2.5 rounded-xl border border-border bg-surface hover:bg-surface-offset transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground border border-primary/20 hover:shadow-lg hover:shadow-primary/20 transition-all"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
