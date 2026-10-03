import React, { useEffect, useState } from 'react';
import { AIMindMeshServerSettings } from '../../types';
import { InsightItem } from '../../services/feedService';
import FeedView from '../../views/FeedView';
import FeedThreadView from '../../views/FeedThreadView';
import ServerAgentView from '../../views/ServerAgentView';
import LibraryView from '../../views/LibraryView';
import WikiView from '../../views/WikiView';
import OrganizationView from '../../views/OrganizationView';

export type AppTab = 'chat' | 'feed' | 'server-agent' | 'library' | 'wiki' | 'organization';

interface AppTabContentProps {
    activeTab: AppTab;
    /** The chat screen, built by App */
    chat: React.ReactNode;
    serverSettings: AIMindMeshServerSettings;
    agentProvider: 'openclaw' | 'hermes';
    openFeedInsight: InsightItem | null;
    onOpenFeedInsight: (insight: InsightItem | null) => void;
    onFeedUnreadCountChange: (count: number) => void;
}

/**
 * Tab screens. A tab stays mounted (hidden) once visited, so switching back keeps its
 * state: conversation with the server agent, feed pages and scroll, open wiki page.
 */
export const AppTabContent: React.FC<AppTabContentProps> = ({
    activeTab, chat, serverSettings, agentProvider, openFeedInsight, onOpenFeedInsight, onFeedUnreadCountChange
}) => {
    const [visited, setVisited] = useState<Set<AppTab>>(() => new Set<AppTab>(['chat', activeTab]));
    useEffect(() => {
        setVisited(prev => (prev.has(activeTab) ? prev : new Set(prev).add(activeTab)));
    }, [activeTab]);

    const enabledServer = serverSettings.enabled ? serverSettings : undefined;
    const pane = (tab: AppTab, content: React.ReactNode) => visited.has(tab) || tab === activeTab ? (
        <div key={tab} className={tab === activeTab ? 'h-full' : 'hidden'}>{content}</div>
    ) : null;

    return (
        <>
            {pane('chat', chat)}

            {pane('feed', (
                <>
                    {/* The list stays mounted under an open thread: closing it returns to the same place */}
                    <div className={openFeedInsight ? 'hidden' : 'h-full'}>
                        <FeedView
                            serverSettings={enabledServer}
                            onOpenThread={onOpenFeedInsight}
                            onUnreadCountChange={onFeedUnreadCountChange}
                        />
                    </div>
                    {openFeedInsight && (
                        <FeedThreadView
                            insight={openFeedInsight}
                            serverSettings={serverSettings}
                            onClose={() => onOpenFeedInsight(null)}
                        />
                    )}
                </>
            ))}

            {pane('server-agent', <ServerAgentView settings={serverSettings} provider={agentProvider} />)}
            {pane('library', <LibraryView serverSettings={enabledServer} />)}
            {pane('wiki', <WikiView serverSettings={enabledServer} />)}
            {pane('organization', <OrganizationView serverSettings={enabledServer} isActive={activeTab === 'organization'} />)}
        </>
    );
};
