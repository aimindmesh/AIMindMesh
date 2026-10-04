/**
 * "Web tools" toggles of the AIMindMesh Server settings: which web tools run on the server
 * (SearXNG search, page reading, search + synthesis) instead of on the phone.
 */

import React from 'react';
import { AIMindMeshServerSettings } from '../../../types';

type WebToolFlag = 'delegateWebSearch' | 'delegateWebScraping' | 'delegateWebAnalysis';

const OPTIONS: { key: WebToolFlag; label: string; description: string }[] = [
    { key: 'delegateWebSearch', label: 'Web search on the server', description: 'search_web uses the server\'s SearXNG; the phone searches by itself if the server fails' },
    { key: 'delegateWebScraping', label: 'Page reading on the server', description: 'read_web_page downloads and cleans pages on the server, saving phone data and memory' },
    { key: 'delegateWebAnalysis', label: 'Web analysis (analyze_web)', description: 'Offers the model a server tool that searches, reads the top pages and writes a sourced answer' },
];

interface Props {
    settings: AIMindMeshServerSettings;
    update: (partial: Partial<AIMindMeshServerSettings>) => void;
}

const toggleCls = 'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer';

const ServerWebToolsSection: React.FC<Props> = ({ settings, update }) => (
    <div className="mb-4 p-3 rounded-lg border border-white/10 bg-surface/30">
        <div className="text-sm font-bold text-text-primary mb-2">Web tools</div>
        {OPTIONS.map(option => {
            const on = !!settings[option.key] && settings.enabled;
            return (
                <div key={option.key} className="flex items-center justify-between gap-3 py-1.5">
                    <div>
                        <div className="text-sm font-medium text-text-primary">{option.label}</div>
                        <div className="text-xs text-text-secondary mt-0.5">{option.description}</div>
                    </div>
                    <button
                        id={`server-${option.key}-toggle`}
                        onClick={() => update({ [option.key]: !settings[option.key] })}
                        className={`${toggleCls} ${on ? 'bg-primary' : 'bg-white/20'}`}
                        disabled={!settings.enabled}
                        aria-pressed={!!settings[option.key]}
                        aria-label={option.label}
                    >
                        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                </div>
            );
        })}
    </div>
);

export default ServerWebToolsSection;
