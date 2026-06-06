import React, { useEffect } from 'react';
import { agentApi } from '../../services/serverApi';
import { useHermesStore } from '../../store/hermesStore';

export interface HermesStatusBadgeProps {
  minimal?: boolean;
}

export const HermesStatusBadge: React.FC<HermesStatusBadgeProps> = ({ minimal }) => {
  const { available, version, setAvailable, setVersion } = useHermesStore();

  useEffect(() => {
    const check = async () => {
      try {
        const { data } = await agentApi.getHermesStatus();
        setAvailable(data.available);
        setVersion(data.version ?? '');
      } catch {
        setAvailable(false);
      }
    };
    check();
    const interval = setInterval(check, 15_000);
    return () => clearInterval(interval);
  }, [setAvailable, setVersion]);

  if (minimal) {
    return (
      <div className="flex items-center gap-3 pr-6 border-r border-border group cursor-help" title={`Hermes Agent ${version}`}>
        <div className={`w-2 h-2 rounded-full ${available ? 'status-dot-online' : 'status-dot-offline'}`} />
        <span className={`text-[11px] font-black uppercase tracking-widest ${available ? 'text-success' : 'text-error'}`}>
          Hermes: {available ? (version || 'READY') : 'OFFLINE'}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all duration-300"
      style={{
        background: available ? 'rgba(139, 92, 246, 0.1)' : 'var(--color-surface-offset)',
        color: available ? '#8b5cf6' : 'var(--color-text-muted)',
        border: `1px solid ${available ? 'rgba(139, 92, 246, 0.2)' : 'var(--color-border)'}`,
        boxShadow: available ? '0 0 12px rgba(139, 92, 246, 0.1)' : 'none'
      }}
    >
      <span className={`w-2 h-2 rounded-full ${available ? 'animate-pulse' : ''}`}
        style={{ background: available ? '#8b5cf6' : 'var(--color-text-faint)' }}
      />
      {available ? `Hermes ${version}` : 'Hermes Offline'}
    </div>
  );
};
