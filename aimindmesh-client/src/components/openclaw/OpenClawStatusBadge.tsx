import React, { useEffect } from 'react';
import { agentApi } from '../../services/serverApi';
import { useOpenClawStore } from '../../store/openclawStore';

export interface OpenClawStatusBadgeProps {
  minimal?: boolean;
}

export const OpenClawStatusBadge: React.FC<OpenClawStatusBadgeProps> = ({ minimal }) => {
  const { available, version, setAvailable, setVersion } = useOpenClawStore();

  useEffect(() => {
    const check = async () => {
      try {
        const { data } = await agentApi.getStatus();
        setAvailable(data.available);
        setVersion(data.version ?? '');
      } catch {
        setAvailable(false);
      }
    };
    check();
    const interval = setInterval(check, 15_000); // More frequent for Admin homogeneity
    return () => clearInterval(interval);
  }, [setAvailable, setVersion]);

  if (minimal) {
    return (
      <div className="flex items-center gap-3 pr-6 border-r border-border group cursor-help" title={`OpenClaw ${version}`}>
        <div className={`w-2 h-2 rounded-full ${available ? 'status-dot-online' : 'status-dot-offline'}`} />
        <span className={`text-[11px] font-black uppercase tracking-widest ${available ? 'text-success' : 'text-error'}`}>
          OpenClaw: {available ? (version || 'READY') : 'OFFLINE'}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all duration-300"
      style={{
        background: available ? 'rgba(34, 197, 94, 0.1)' : 'var(--color-surface-offset)',
        color: available ? '#22c55e' : 'var(--color-text-muted)',
        border: `1px solid ${available ? 'rgba(34, 197, 94, 0.2)' : 'var(--color-border)'}`,
        boxShadow: available ? '0 0 12px rgba(34, 197, 94, 0.1)' : 'none'
      }}
    >
      <span className={`w-2 h-2 rounded-full ${available ? 'animate-pulse' : ''}`}
        style={{ background: available ? '#22c55e' : 'var(--color-text-faint)' }}
      />
      {available ? `OpenClaw ${version}` : 'Agent Offline'}
    </div>
  );
};
