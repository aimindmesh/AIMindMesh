import { AlertCircle, CheckCircle2, Download, RefreshCw } from 'lucide-react';
import type { AppConfig } from '../../store/configStore';
import pkg from '../../../package.json';

/** Result of the last release check (GET /dl/versions.json). */
export interface UpdateStatus {
  latestVersion?: string;
  isNewer: boolean;
  deb?: string;
  appimage?: string;
  isLoading: boolean;
  error?: string;
}

interface SoftwareUpdatesPanelProps {
  localConfig: AppConfig;
  setLocalConfig: (config: AppConfig) => void;
  updateStatus: UpdateStatus;
  checkUpdates: (silent?: boolean) => void;
}

/** Current version, automatic update checks and the download links of a newer release. */
export function SoftwareUpdatesPanel({ localConfig, setLocalConfig, updateStatus, checkUpdates }: SoftwareUpdatesPanelProps) {
  return (
    <div className="glass-panel rounded-2xl p-8 flex flex-col gap-6 max-w-2xl mb-8">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <h2 className="text-xl font-semibold">Software Updates</h2>
        <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground bg-secondary/30 px-2 py-1 rounded">
          Current: v{pkg.version}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={localConfig.updates?.check_automatic}
              onChange={(e) => setLocalConfig({ ...localConfig, updates: { ...localConfig.updates, check_automatic: e.target.checked } })}
              className="w-5 h-5 rounded accent-primary border-border bg-background"
            />
            <span className="font-medium text-sm">Automatically Check for Updates</span>
          </label>

          <button
            onClick={() => checkUpdates(false)}
            disabled={updateStatus.isLoading}
            className="p-2 hover:bg-secondary/50 rounded-lg transition-all text-primary flex items-center gap-2 text-sm font-semibold"
          >
            <RefreshCw className={`w-4 h-4 ${updateStatus.isLoading ? 'animate-spin' : ''}`} />
            Check Now
          </button>
        </div>

        {updateStatus.error && (
          <div className="bg-destructive/10 border border-destructive/30 text-destructive p-3 rounded-lg flex items-center gap-2 text-sm">
            <AlertCircle className="w-4 h-4" />
            {updateStatus.error}
          </div>
        )}

        {updateStatus.latestVersion && !updateStatus.isNewer && !updateStatus.error && (
          <div className="bg-success/10 border border-success/30 text-success p-3 rounded-lg flex items-center gap-2 text-sm">
            <CheckCircle2 className="w-4 h-4" />
            You are running the latest version (v{pkg.version})
          </div>
        )}

        {updateStatus.isNewer && (
          <div className="bg-primary/10 border border-primary/30 p-4 rounded-xl flex flex-col gap-4 animate-pulse-subtle">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/20 rounded-lg">
                <Download className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="font-bold text-primary">Update Available: v{updateStatus.latestVersion}</h3>
                <p className="text-xs text-muted-foreground">A new version of AIMindMesh is ready for download.</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              {updateStatus.deb && (
                <a
                  href={`${localConfig.server.url.replace(/\/$/, '')}/dl/${updateStatus.deb}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 bg-primary text-surface px-4 py-2.5 rounded-lg text-center text-sm font-bold hover:bg-primary-hover transition-all flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download .DEB
                </a>
              )}
              {updateStatus.appimage && (
                <a
                  href={`${localConfig.server.url.replace(/\/$/, '')}/dl/${updateStatus.appimage}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 bg-secondary text-primary px-4 py-2.5 rounded-lg text-center text-sm font-bold hover:bg-secondary/80 transition-all flex items-center justify-center gap-2 border border-primary/20"
                >
                  <Download className="w-4 h-4" />
                  Download .AppImage
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
