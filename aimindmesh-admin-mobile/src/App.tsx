import { useEffect, useState } from 'react';
import { LayoutDashboard, ScrollText, FolderInput, Settings, Cpu, BarChart3, ShieldAlert, MonitorDot, MoreHorizontal, X } from 'lucide-react';
import { App as CapApp } from '@capacitor/app';


import CockpitView    from './views/CockpitView';
import SystemLogsView from './views/SystemLogsView';
import IngestionView  from './views/IngestionView';
import EvolutionView  from './views/EvolutionView';
import SettingsView   from './views/SettingsView';
import StatsView      from './views/StatsView';
import QuarantineView from './views/QuarantineView';
import KasmView       from './views/KasmView';

import { useNavigationStore, TabId } from './store/navigationStore';

import './index.css';


const MAIN_TABS: { id: TabId; label: string; Icon: React.ElementType }[] = [
  { id: 'cockpit',   label: 'Console',   Icon: LayoutDashboard },
  { id: 'quarantine',label: 'Failed',    Icon: ShieldAlert     },
  { id: 'stats',     label: 'Stats',     Icon: BarChart3       },
  { id: 'logs',      label: 'Logs',      Icon: ScrollText       },
];

const MENU_TABS: { id: TabId; label: string; Icon: React.ElementType }[] = [
  { id: 'kasm',      label: 'Kasm',      Icon: MonitorDot       },
  { id: 'ingest',    label: 'Ingest',    Icon: FolderInput      },
  { id: 'evolution', label: 'Evolution', Icon: Cpu              },
  { id: 'settings',  label: 'Settings',  Icon: Settings         },
];


export default function App() {
  const { activeTab, setActiveTab } = useNavigationStore();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // ── Global Back Button ─────────────────────────────────────────────────────
  useEffect(() => {
    let listenerHandle: any;
    const setup = async () => {
      listenerHandle = await CapApp.addListener('backButton', ({ canGoBack }) => {
        if (isMenuOpen) {
          setIsMenuOpen(false);
          return;
        }
        
        // If some component handled the back button (e.g. modal closed), skip
        if ((window as any).__cap_back_handled) return;

        // Exit the app instead of switching tabs, or let system handle
        if (!canGoBack) {
          CapApp.exitApp();
        }
      });
    };
    setup();
    return () => { listenerHandle?.remove(); };
  }, [activeTab, isMenuOpen]);

  const renderView = () => {
    switch (activeTab) {
      case 'cockpit':   return <CockpitView />;
      case 'quarantine':return <QuarantineView />;
      case 'stats':     return <StatsView />;
      case 'logs':      return <SystemLogsView />;
      case 'ingest':    return <IngestionView />;
      case 'evolution': return <EvolutionView />;
      case 'settings':  return <SettingsView />;
      case 'kasm':      return <KasmView />;
    }
  };

  const isTabInMenu = MENU_TABS.some(t => t.id === activeTab);

  return (
    <div className="h-screen w-screen flex flex-col bg-background overflow-hidden">
      {/* Main Content */}
      <div className="flex-1 overflow-hidden relative">
        {renderView()}

        {/* Menu Overlay */}
        {isMenuOpen && (
          <div className="menu-overlay">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-2xl font-black italic tracking-tighter">SYSTEM MENU</h2>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-1">Secondary Utilities</p>
              </div>
              <button 
                onClick={() => setIsMenuOpen(false)}
                className="p-4 rounded-2xl bg-surface-hover text-foreground border border-border"
              >
                <X size={24} />
              </button>
            </div>

            <div className="menu-grid">
              {MENU_TABS.map(({ id, label, Icon }) => {
                const isActive = activeTab === id;
                return (
                  <button
                    key={id}
                    onClick={() => { setActiveTab(id); setIsMenuOpen(false); }}
                    className={`menu-item ${isActive ? 'active' : ''}`}
                  >
                    <div className={`p-4 rounded-2xl ${isActive ? 'bg-primary/20 text-primary' : 'bg-background/40 text-muted-foreground'}`}>
                      <Icon size={24} />
                    </div>
                    <span className={isActive ? 'text-primary' : 'text-muted-foreground'}>{label}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-auto p-6 bg-surface/50 border border-border/50 rounded-3xl opacity-50">
               <p className="text-[9px] font-black uppercase tracking-[0.3em] text-center">AI Mind Mesh Admin v0.1.0</p>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Navigation */}
      <nav 
        className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around bg-background/60 backdrop-blur-3xl border-t border-border/40"
        style={{ 
          height: 'var(--nav-height)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)'
        }}
      >
        {MAIN_TABS.map(({ id, label, Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => { setActiveTab(id); setIsMenuOpen(false); }}
              className={`flex-1 flex flex-col items-center justify-center gap-1.5 h-full transition-all duration-300 relative ${
                isActive ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <div className={`p-2.5 rounded-2xl transition-all duration-300 ${isActive ? 'bg-primary/15 scale-110 shadow-[0_0_20px_rgba(79,143,247,0.15)]' : ''}`}>
                <Icon
                  size={20}
                  className="transition-all"
                  strokeWidth={isActive ? 2.5 : 2}
                />
              </div>
              <span className={`text-[9px] font-black uppercase tracking-[0.1em] transition-all ${isActive ? 'opacity-100' : 'opacity-60'}`}>
                {label}
              </span>
              {isActive && (
                <div className="absolute top-1 left-1/4 right-1/4 h-[2px] bg-primary shadow-[0_0_15px_rgba(79,143,247,0.6)] rounded-full" />
              )}
            </button>
          );
        })}

        {/* More Button */}
        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className={`flex-1 flex flex-col items-center justify-center gap-1.5 h-full transition-all duration-300 relative ${
            isTabInMenu || isMenuOpen ? 'text-primary' : 'text-muted-foreground'
          }`}
        >
          <div className={`p-2.5 rounded-2xl transition-all duration-300 ${isTabInMenu || isMenuOpen ? 'bg-primary/15 scale-110 shadow-[0_0_20px_rgba(79,143,247,0.15)]' : ''}`}>
            <MoreHorizontal
              size={20}
              className="transition-all"
              strokeWidth={(isTabInMenu || isMenuOpen) ? 2.5 : 2}
            />
          </div>
          <span className={`text-[9px] font-black uppercase tracking-[0.1em] transition-all ${(isTabInMenu || isMenuOpen) ? 'opacity-100' : 'opacity-60'}`}>
            More
          </span>
          {(isTabInMenu || isMenuOpen) && (
            <div className="absolute top-1 left-1/4 right-1/4 h-[2px] bg-primary shadow-[0_0_15px_rgba(79,143,247,0.6)] rounded-full" />
          )}
        </button>
      </nav>
    </div>
  );
}

