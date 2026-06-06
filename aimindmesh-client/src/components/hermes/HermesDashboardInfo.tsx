import React from 'react';
import { useConfigStore } from '../../store/configStore';

export const HermesDashboardInfo: React.FC = () => {
  const appConfig = useConfigStore((s) => s.config);
  
  // Extract server host from the configured API URL
  const getServerHost = () => {
    if (!appConfig?.server?.url) return '<server-host>';
    try {
      const url = new URL(appConfig.server.url);
      return url.hostname;
    } catch {
      // Fallback for simple hosts or invalid formats
      return appConfig.server.url.replace(/^https?:\/\//, '').split(':')[0] || '<server-host>';
    }
  };

  const host = getServerHost();

  const openExternalLink = (url: string) => {
    // Open in default browser via window or Tauri shell if available
    window.open(url, '_blank');
  };

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto h-full animate-in zoom-in-95 duration-500 bg-background">
      <div className="border-b border-border pb-4">
        <h3 className="text-xl font-bold tracking-tight">Hermes Dashboard Access</h3>
        <p className="text-sm text-muted-foreground mt-1">Nous Research Hermes Agent exposes an interactive web dashboard on port <code className="font-mono bg-surface-2 px-1 py-0.5 rounded text-purple-600">9119</code>.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Method 1: VPN */}
        <div className="rounded-2xl border border-border bg-surface/40 p-6 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-xl bg-purple-600/10 border border-purple-500/20 flex items-center justify-center text-purple-400 font-bold">1</span>
            <h4 className="font-bold text-sm tracking-wide uppercase">Direct VPN Access</h4>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            If you are connected to the WireGuard / OpenVPN network, you can access the container's dashboard directly from your web browser.
          </p>
          <div className="bg-surface-2/50 border border-border rounded-xl p-4 font-mono text-xs text-purple-400 select-all cursor-pointer truncate" onClick={() => openExternalLink('http://[hermes-vpn-ip]:9119')}>
            http://[hermes-vpn-ip]:9119
          </div>
          <button
            onClick={() => openExternalLink('http://[hermes-vpn-ip]:9119')}
            className="mt-auto rounded-xl border border-purple-600/40 hover:bg-purple-600 hover:text-white transition-all text-purple-400 font-bold text-xs py-3 tracking-widest uppercase"
          >
            OPEN IN BROWSER
          </button>
        </div>

        {/* Method 2: SSH Tunnel */}
        <div className="rounded-2xl border border-border bg-surface/40 p-6 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-xl bg-purple-600/10 border border-purple-500/20 flex items-center justify-center text-purple-400 font-bold">2</span>
            <h4 className="font-bold text-sm tracking-wide uppercase">Secure SSH Tunnel</h4>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            For secure remote access without VPN, create an SSH tunnel from your local machine to forward port 9119.
          </p>
          <div className="bg-surface-2/50 border border-border rounded-xl p-4 font-mono text-xs text-muted-foreground select-all break-all leading-normal">
            ssh -L 9119:[hermes-vpn-ip]:9119 {host}
          </div>
          <p className="text-[10px] text-muted-foreground italic leading-relaxed">
            Run the command above, then navigate to your local loopback address:
            <br />
            <span className="text-purple-400 hover:underline cursor-pointer" onClick={() => openExternalLink('http://localhost:9119')}>http://localhost:9119</span>
          </p>
        </div>
      </div>

      {/* Access info notice */}
      <div className="p-5 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex gap-4">
        <span className="text-2xl mt-0.5">ℹ️</span>
        <div className="flex flex-col gap-1">
          <h5 className="text-xs font-bold text-amber-500 uppercase tracking-widest">Network Binding Details</h5>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            The dashboard port is explicitly bound to <code className="font-mono">10.2.0.1:9119</code> and <code className="font-mono">127.0.0.1:9119</code> on the VPS host to prevent public exposition on the WAN interface. This ensures strict isolation and safety from outer network probes.
          </p>
        </div>
      </div>
    </div>
  );
};
