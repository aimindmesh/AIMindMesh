import React from 'react';

interface AppNavbarProps {
    activeTab: 'chat' | 'feed' | 'server-agent' | 'library' | 'wiki' | 'organization';
    onTabChange: (tab: 'chat' | 'feed' | 'server-agent' | 'library' | 'wiki' | 'organization') => void;
    feedUnreadCount: number;
}

export const AppNavbar: React.FC<AppNavbarProps> = ({ activeTab, onTabChange, feedUnreadCount }) => {
    const NAV_TABS = [
        { id: 'chat', label: 'Chat', icon: '💬' },
        { id: 'server-agent', label: 'Agent', icon: '🤖' },
        { id: 'wiki', label: 'Wiki', icon: '📖' },
        { id: 'organization', label: 'Council', icon: '🏛️' },
        { id: 'feed', label: 'Feed', icon: '✨', badge: feedUnreadCount > 0 ? feedUnreadCount : undefined },
        { id: 'library', label: 'Library', icon: '🗄️' },
    ] as const;

    return (
        <nav className="shrink-0 flex items-center justify-around bg-surface/80 border-t border-white/5 backdrop-blur-md px-2 py-1 pb-safe z-30">
            {NAV_TABS.map(tab => (
                <button
                    key={tab.id}
                    id={`nav-tab-${tab.id}`}
                    onClick={() => onTabChange(tab.id as any)}
                    className={`relative flex flex-col items-center gap-0.5 px-4 py-2 rounded-xl transition-all ${
                        activeTab === tab.id
                            ? 'text-primary bg-primary/10'
                            : 'text-text-secondary hover:text-text-primary'
                    }`}
                >
                    <span className="text-lg">{tab.icon}</span>
                    <span className="text-[10px] font-medium">{tab.label}</span>
                    {'badge' in tab && tab.badge ? (
                        <span className="absolute top-1 right-2 min-w-[16px] h-4 bg-primary text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1">
                            {tab.badge > 99 ? '99+' : tab.badge}
                        </span>
                    ) : null}
                </button>
            ))}
        </nav>
    );
};
