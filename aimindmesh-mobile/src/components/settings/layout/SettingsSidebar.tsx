import React from 'react';
import { triggerHaptic } from '../../../services/native';

interface SettingsSidebarProps {
    activeTab: string;
    setActiveTab: (tab: any) => void;
}

const SettingsSidebar: React.FC<SettingsSidebarProps> = ({ activeTab, setActiveTab }) => {
    const menuItems = [
        { id: 'setup', label: 'Initial Setup', icon: '🚀' },
        { id: 'personality', label: 'Personality', icon: '🎭' },
        { id: 'llm', label: 'LLM Intelligence', icon: '🧠' },
        { id: 'knowledge', label: 'Knowledge & RAG', icon: '📖' },
        { id: 'agentic', label: 'Agentic', icon: '🔧' },
        { id: 'proactive', label: 'Proactive', icon: '⚡' },
        { id: 'vision', label: 'Vision', icon: '👁️' },
        { id: 'stt', label: 'Speech-to-Text', icon: '🎤' },
        { id: 'wakeword', label: 'Wake Word', icon: '⏰' },
        { id: 'tts', label: 'Text-to-Speech', icon: '🗣️' },
        { id: 'speaker', label: 'Speaker ID', icon: '👤' },
        { id: 'memory', label: 'Memory', icon: '💾' },
        { id: 'agenda', label: 'Agenda', icon: '📅' },
        { id: 'storage', label: 'File Storage', icon: '📂' },
        { id: 'theme', label: 'Theme', icon: '🎨' },
        { id: 'aimindmesh-server', label: 'AIMindMesh Server', icon: '🌐' },
        { id: 'app', label: 'App & Utils', icon: '⚙️' },
        { id: 'log', label: 'System Logs', icon: '📜' },
        { id: 'auto', label: 'Android Auto', icon: '🚗' },
        { id: 'docs', label: 'Documentation', icon: '📚' }
    ];

    return (
        <aside className="w-64 bg-surface/20 border-r border-surface overflow-y-auto hidden md:block">
            <nav className="p-4 space-y-2">
                {menuItems.map((item) => (
                    <button
                        key={item.id}
                        onClick={() => { setActiveTab(item.id); triggerHaptic(); }}
                        className={`w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 transition-all ${activeTab === item.id
                            ? 'bg-primary/20 text-primary border border-primary/20'
                            : 'text-text-secondary hover:bg-surface/50 hover:text-text-primary'
                            }`}
                    >
                        <span className="text-lg">{item.icon}</span>
                        <span className="font-medium">{item.label}</span>
                    </button>
                ))}
            </nav>
        </aside>
    );
};

export default SettingsSidebar;
