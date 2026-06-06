import React, { useState } from 'react';
import { AgentConsole } from '../components/openclaw/AgentConsole';
import { SkillsManager } from '../components/openclaw/SkillsManager';
import { CronManager } from '../components/openclaw/CronManager';
import { SoulEditor } from '../components/openclaw/SoulEditor';
import { GoogleAuthSettings } from '../components/openclaw/GoogleAuthSettings';
import { OpenClawStatusBadge } from '../components/openclaw/OpenClawStatusBadge';
import { WorkspaceExplorer } from '../components/openclaw/WorkspaceExplorer';

// Hermes Imports
import { HermesStatusBadge } from '../components/hermes/HermesStatusBadge';
import { HermesConsole } from '../components/hermes/HermesConsole';
import { HermesConfigEditor } from '../components/hermes/HermesConfigEditor';
import { HermesDashboardInfo } from '../components/hermes/HermesDashboardInfo';

type OpenClawTab = 'console' | 'skills' | 'cron' | 'config' | 'workspace' | 'auth';
type HermesTab = 'console' | 'config' | 'dashboard';

const OPENCLAW_TABS: { key: OpenClawTab; label: string; icon: string }[] = [
  { key: 'console', label: 'Agent Console', icon: '🤖' },
  { key: 'skills', label: 'Skills', icon: '⚡' },
  { key: 'cron', label: 'Cron Jobs', icon: '📅' },
  { key: 'config', label: 'Config Files', icon: '📝' },
  { key: 'workspace', label: 'Workspace Files', icon: '📂' },
  { key: 'auth', label: 'Google Auth', icon: '🔐' },
];

const HERMES_TABS: { key: HermesTab; label: string; icon: string }[] = [
  { key: 'console', label: 'Console', icon: '🤖' },
  { key: 'config', label: 'Config Editor', icon: '📝' },
  { key: 'dashboard', label: 'Dashboard', icon: '📊' },
];

export const OpenClawView: React.FC = () => {
  const [provider, setProvider] = useState<'openclaw' | 'hermes'>('openclaw');
  const [openClawTab, setOpenClawTab] = useState<OpenClawTab>('console');
  const [hermesTab, setHermesTab] = useState<HermesTab>('console');

  return (
    <div className="flex flex-col h-full bg-background animate-in fade-in duration-700">
      {/* Header */}
      <div className="px-8 py-6 border-b border-border bg-surface-2/30 backdrop-blur-md sticky top-0 z-10 flex justify-between items-center">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-black tracking-tighter">
              {provider === 'openclaw' ? 'OpenClaw Agent' : 'Hermes Agent'}
            </h2>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest border ${
              provider === 'openclaw' 
                ? 'bg-primary/10 text-primary border-primary/20' 
                : 'bg-purple-600/10 text-purple-400 border-purple-500/20'
            }`}>
              {provider === 'openclaw' ? 'PREMIUM SIDECAR' : 'COGNITIVE GATEWAY'}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1 font-medium italic opacity-70">
            {provider === 'openclaw' 
              ? 'Autonomous execution engine for the Server architecture.' 
              : 'Nous Research agent with multi-modal tool integrations.'}
          </p>
        </div>

        <div className="flex items-center gap-4">
          {/* Segment Switcher */}
          <div className="flex bg-surface-2/80 p-1 rounded-xl border border-border shadow-inner">
            <button
              onClick={() => setProvider('openclaw')}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 ${
                provider === 'openclaw'
                  ? 'bg-primary text-primary-foreground shadow-md scale-[1.02]'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              OpenClaw
            </button>
            <button
              onClick={() => setProvider('hermes')}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 ${
                provider === 'hermes'
                  ? 'bg-purple-600 text-white shadow-md scale-[1.02]'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Hermes Agent
            </button>
          </div>

          {/* Status Badge */}
          {provider === 'openclaw' ? <OpenClawStatusBadge /> : <HermesStatusBadge />}
        </div>
      </div>

      {/* Navigation */}
      <div className="px-8 mt-6 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        <div className="flex gap-2 p-1 bg-surface-2/50 rounded-2xl border border-border w-fit shadow-inner">
          {provider === 'openclaw' ? (
            OPENCLAW_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setOpenClawTab(tab.key)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 whitespace-nowrap ${
                  openClawTab === tab.key 
                    ? 'bg-surface border-border shadow-md text-primary scale-[1.02]' 
                    : 'text-muted-foreground hover:text-foreground hover:bg-surface-offset/50'
                }`}
              >
                <span className="text-base grayscale group-hover:grayscale-0">{tab.icon}</span>
                {tab.label}
              </button>
            ))
          ) : (
            HERMES_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setHermesTab(tab.key)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 whitespace-nowrap ${
                  hermesTab === tab.key 
                    ? 'bg-surface border-border shadow-md text-purple-400 scale-[1.02]' 
                    : 'text-muted-foreground hover:text-foreground hover:bg-surface-offset/50'
                }`}
              >
                <span className="text-base grayscale group-hover:grayscale-0">{tab.icon}</span>
                {tab.label}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto px-8 py-8" style={{ scrollbarWidth: 'thin' }}>
        <div className="max-w-6xl mx-auto h-full">
          {provider === 'openclaw' ? (
            <>
              {openClawTab === 'console' && <AgentConsole />}
              {openClawTab === 'skills' && <SkillsManager />}
              {openClawTab === 'cron' && <CronManager />}
              {openClawTab === 'config' && <SoulEditor />}
              {openClawTab === 'workspace' && <WorkspaceExplorer />}
              {openClawTab === 'auth' && <GoogleAuthSettings />}
            </>
          ) : (
            <>
              {hermesTab === 'console' && <HermesConsole />}
              {hermesTab === 'config' && <HermesConfigEditor />}
              {hermesTab === 'dashboard' && <HermesDashboardInfo />}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

