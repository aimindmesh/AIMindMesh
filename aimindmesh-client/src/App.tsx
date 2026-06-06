import { useEffect } from "react";
import FeedView from "./views/FeedView";
import ChatView from "./views/ChatView";
import KGBrowser from "./views/KGBrowser";
import AdminPanel from "./views/AdminPanel";
import SettingsView from "./views/SettingsView";
import LogsView from "./views/LogsView";
import KnowledgeBase from "./views/KnowledgeBase";
import { OpenClawView } from "./views/OpenClawView";
import TaskManagerView from "./views/TaskManagerView";
import NeuralArchives from "./views/NeuralArchives";
import KasmView from "./views/KasmView";
import { initTauriEvents } from "./services/tauriEvents";
import { MessageSquareDot, Rss, Network, ShieldCheck, Settings, Terminal, Database, Bot, CalendarCheck2, Archive, BookOpen, Sparkles, MonitorDot, Briefcase } from "lucide-react";
import { invoke } from '@tauri-apps/api/core';
import { useConfigStore, AppConfig } from './store/configStore';
import { useUIStore } from "./store/uiStore";
import { Logger } from "./utils/logger";
import WikiExplorer from "./views/WikiExplorer";
import EvolutionView from "./views/EvolutionView";
import OrganizationView from "./views/OrganizationView";

export default function App() {
  const { activeTab, setActiveTab, performanceMode } = useUIStore();
  const { config, setConfig } = useConfigStore();

  useEffect(() => {
    if (performanceMode) {
      document.body.classList.add('perf-mode');
    } else {
      document.body.classList.remove('perf-mode');
    }
  }, [performanceMode]);

  useEffect(() => {
    if (!activeTab || activeTab === 'dashboard') {
      setActiveTab('chat');
    }
  }, []);

  useEffect(() => {
    initTauriEvents();

    if (!config) {
      invoke<AppConfig>('get_config')
        .then((c) => {
          setConfig(c);
          if (c.logging?.level) {
            Logger.setLevel(c.logging.level);
          }
        })
        .catch(err => console.error("Failed to load config:", err));
    }
  }, [config, setConfig]);

  const renderView = () => {
    switch (activeTab) {
      case "feed": return <FeedView />;
      case "chat": return <ChatView />;
      case "kg": return <KGBrowser />;
      case "kb": return <KnowledgeBase />;
      case "agent": return <OpenClawView />;
      case "tasks": return <TaskManagerView />;
      case "admin": return <AdminPanel />;
      case "archives": return <NeuralArchives />;
      case "wiki": return <WikiExplorer />;
      case "logs": return <LogsView />;
      case "settings": return <SettingsView />;
      case "evolution": return <EvolutionView />;
      case "kasm": return <KasmView />;
      case "organization": return <OrganizationView />;
      default: return <ChatView />;
    }
  };

  const navItems = [
    { id: "chat", label: "Chat", icon: MessageSquareDot },
    { id: "feed", label: "Feed", icon: Rss },
    { id: "kg", label: "KG Browser", icon: Network },
    { id: "kb", label: "Knowledge Base", icon: Database },
    { id: "agent", label: "AI Agent", icon: Bot },
    { id: "tasks", label: "AI Tasks", icon: CalendarCheck2 },
    { id: "archives", label: "Neural Archives", icon: Archive },
    { id: "wiki", label: "Neural Wiki", icon: BookOpen },
    { id: "evolution", label: "Auto-Evolution", icon: Sparkles },
    { id: "kasm", label: "Kasm Workspaces", icon: MonitorDot },
    { id: "organization", label: "AI Council", icon: Briefcase },
    { id: "admin", label: "Admin Panel", icon: ShieldCheck },
    { id: "logs", label: "System Logs", icon: Terminal },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="h-screen w-screen flex bg-background text-foreground overflow-hidden select-none" data-theme="dark">
      {/* Sidebar */}
      <nav className="w-72 glass-panel border-r border-border flex flex-col shrink-0 z-10 transition-all duration-300">
        <div className="p-6">
          <h2 className="text-xl font-bold tracking-tight italic bg-gradient-to-br from-primary to-primary-hover bg-clip-text text-transparent">AIMindMesh</h2>
          <span className="text-xs text-muted-foreground uppercase tracking-widest font-semibold ml-1">Client PC</span>
        </div>

        <div className="flex-1 flex flex-col gap-2 px-4 py-2">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium ${activeTab === item.id
                  ? "bg-surface-hover text-primary"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                }`}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </button>
          ))}
        </div>

        <div className="p-4 pb-12 border-t border-border mt-auto">
          <div className="text-[10px] uppercase font-bold text-center text-muted-foreground opacity-40 tracking-widest">
            System Node: <span className="text-primary/60 uppercase">{config?.node?.name || config?.node?.id || 'laptop'}</span>
          </div>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 relative overflow-auto bg-background custom-scrollbar">
        <div className="h-full relative">
          <div className="absolute inset-0 opacity-5 bg-gradient-to-br from-primary via-transparent to-transparent pointer-events-none"></div>
          {renderView()}
        </div>
      </main>
    </div>
  );
}
