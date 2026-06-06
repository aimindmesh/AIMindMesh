import React from 'react';

interface SettingsMobileTabsProps {
    activeTab: string;
    setActiveTab: (tab: any) => void;
}

const SettingsMobileTabs: React.FC<SettingsMobileTabsProps> = ({ activeTab, setActiveTab }) => {
    const menuItems = [
        { id: 'setup', label: 'Initial Setup', icon: '🚀' },
        { id: 'personality', label: 'Personality', icon: '🎭' },
        { id: 'llm', label: 'LLM Intelligence', icon: '🧠' },
        { id: 'knowledge', label: 'Knowledge', icon: '📖' },
        { id: 'agentic', label: 'Agentic', icon: '🔧' },
        { id: 'proactive', label: 'Proactive', icon: '⚡' },
        { id: 'vision', label: 'Vision', icon: '👁️' },
        { id: 'stt', label: 'Speech-to-Text', icon: '🎤' },
        { id: 'wakeword', label: 'Wake Word', icon: '⏰' },
        { id: 'tts', label: 'Text-to-Speech', icon: '🗣️' },
        { id: 'speaker', label: 'Speaker ID', icon: '👤' },
        { id: 'memory', label: 'Memory', icon: '💾' },
        { id: 'agenda', label: 'Agenda', icon: '📅' },
        { id: 'storage', label: 'Files', icon: '📂' },
        { id: 'theme', label: 'Theme', icon: '🎨' },
        { id: 'aimindmesh-server', label: 'Server', icon: '🌐' },
        { id: 'app', label: 'App & Utils', icon: '⚙️' },
        { id: 'log', label: 'System Logs', icon: '📜' },
        { id: 'auto', label: 'Auto', icon: '🚗' },
        { id: 'docs', label: 'Docs', icon: '📚' }
    ];

    return (
        <div className="md:hidden flex overflow-x-auto border-b border-surface bg-background flex-shrink-0 min-h-[70px]">
            {menuItems.map((item) => (
                <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={`flex-shrink-0 px-4 py-3 text-xs font-medium flex flex-col items-center gap-1 border-b-2 transition-colors ${activeTab === item.id
                        ? 'border-primary text-primary'
                        : 'border-transparent text-text-secondary'
                        }`}
                >
                    <span className="text-base">{item.icon}</span>
                    <span>{item.label}</span>
                </button>
            ))}
        </div>
    );
};

export default SettingsMobileTabs;
