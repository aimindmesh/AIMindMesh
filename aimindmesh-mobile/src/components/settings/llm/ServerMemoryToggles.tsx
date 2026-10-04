import React from 'react';
import { useLocalStorage } from '../../../hooks/useLocalStorage';

/** Read by llmService when the server answers (outside React) */
export const SHARE_PROFILE_KEY = 'share-profile-with-server';

const Toggle: React.FC<{ id: string; title: string; description: string; on: boolean; onChange: (on: boolean) => void }> = ({ id, title, description, on, onChange }) => (
    <div className="flex items-center justify-between gap-3 mt-6 pt-5 border-t border-white/5">
        <div>
            <div className="text-sm font-medium text-text-primary">{title}</div>
            <div className="text-xs text-text-secondary mt-0.5">{description}</div>
        </div>
        <button
            id={id}
            onClick={() => onChange(!on)}
            className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors cursor-pointer ${on ? 'bg-primary' : 'bg-white/20'}`}
            aria-pressed={on}
        >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </button>
    </div>
);

/** What of the memory the server gets: the facts (KG mirror) and the profile in its prompts */
export const ServerMemoryToggles: React.FC<{ autoSync: boolean; onAutoSyncChange: (on: boolean) => void }> = ({ autoSync, onAutoSyncChange }) => {
    const [shareProfile, setShareProfile] = useLocalStorage<boolean>(SHARE_PROFILE_KEY, false);
    return (
        <>
            <Toggle
                id="settings-auto-sync-memories-toggle"
                title="Auto-Sync New Memories"
                description="Mirror what I know about you in the server KG (updated and deleted with it)"
                on={autoSync}
                onChange={onAutoSyncChange}
            />
            <Toggle
                id="settings-share-profile-toggle"
                title="Share What I Know With the Server"
                description="When the server answers, it also gets your profile. Off by default: the server may route the request to other mesh nodes"
                on={shareProfile}
                onChange={setShareProfile}
            />
        </>
    );
};
