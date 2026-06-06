import { Download, Cpu, Smartphone, Calendar, Package } from 'lucide-react';
import { ReleaseInfo } from '../../services/serverApi';

interface ReleaseManagerProps {
  releases: { pc?: ReleaseInfo; android?: ReleaseInfo } | null;
}

export function ReleaseManager({ releases }: ReleaseManagerProps) {
  if (!releases) {
    return (
      <div className="flex flex-col items-center justify-center p-20 glass-panel rounded-3xl opacity-50">
        <Package className="w-12 h-12 mb-4 animate-pulse" />
        <p className="text-sm font-bold uppercase tracking-widest">Checking distribution nodes...</p>
      </div>
    );
  }

  const ReleaseCard = ({ title, info, icon: Icon, color }: { title: string; info?: ReleaseInfo; icon: any; color: string }) => (
    <div className="glass-panel p-8 rounded-3xl flex flex-col gap-6 group hover:border-primary/30 transition-all border border-transparent">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className={`p-4 rounded-2x ${color} bg-opacity-10 text-opacity-100 flex items-center justify-center`}>
            <Icon size={28} className={color.replace('bg-', 'text-')} />
          </div>
          <div>
            <h3 className="text-xl font-bold tracking-tight">{title}</h3>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest mt-1">Platform Release</p>
          </div>
        </div>
        {info && (
          <div className="text-right">
            <span className="text-3xl font-black tracking-tighter text-primary/80">v{info.version}</span>
            <div className="flex items-center gap-2 justify-end mt-1 text-[10px] font-mono text-muted-foreground opacity-60">
              <Calendar size={10} />
              {new Date(info.timestamp).toLocaleDateString()}
            </div>
          </div>
        )}
      </div>

      <div className="h-px bg-white/5 w-full" />

      {info ? (
        <div className="grid grid-cols-1 gap-3">
          {info.deb && (
            <a href={info.deb} download className="flex items-center justify-between p-4 bg-surface hover:bg-surface-hover rounded-xl border border-border transition-all group/btn">
              <span className="text-xs font-bold font-mono">Debian/Ubuntu (.deb)</span>
              <Download size={16} className="text-muted-foreground group-hover/btn:text-primary transition-colors" />
            </a>
          )}
          {info.appimage && (
            <a href={info.appimage} download className="flex items-center justify-between p-4 bg-surface hover:bg-surface-hover rounded-xl border border-border transition-all group/btn">
              <span className="text-xs font-bold font-mono">Linux AppImage</span>
              <Download size={16} className="text-muted-foreground group-hover/btn:text-primary transition-colors" />
            </a>
          )}
          {info.apk && (
            <a href={info.apk} download className="flex items-center justify-between p-4 bg-surface hover:bg-surface-hover rounded-xl border border-border transition-all group/btn">
              <span className="text-xs font-bold font-mono">Android (.apk)</span>
              <Download size={16} className="text-muted-foreground group-hover/btn:text-primary transition-colors" />
            </a>
          )}
        </div>
      ) : (
        <div className="p-10 text-center border-2 border-dashed border-border rounded-2xl opacity-40">
           <p className="text-xs font-bold uppercase tracking-widest">No builds detected on this node</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <ReleaseCard 
        title="Desktop Core" 
        info={releases.pc} 
        icon={Cpu} 
        color="bg-primary" 
      />
      <ReleaseCard 
        title="Mobile Client" 
        info={releases.android} 
        icon={Smartphone} 
        color="bg-success" 
      />
    </div>
  );
}
