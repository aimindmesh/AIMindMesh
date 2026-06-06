import React from 'react';
import { LLMConfig } from '../../../types';

interface ServerModelSettingsProps {
    llmConfig: LLMConfig;
}

const ServerModelSettings: React.FC<ServerModelSettingsProps> = () => {
    return (
        <fieldset className="bg-purple-500/10 border border-purple-500/20 p-4 rounded-xl">
            <legend className="text-sm font-semibold text-purple-400 mb-2 px-2 flex items-center gap-2">
                🌐 AIMindMesh Server Engine
            </legend>
            <div className="space-y-4 px-2">
                <p className="text-sm text-text-secondary leading-relaxed">
                    You have selected the Distributed Ecosystem provider. All inference requests will be securely routed via WebSocket to your configured VPS.
                </p>
                <div className="p-3 bg-surface/50 border border-white/5 rounded-lg flex items-start gap-3">
                    <span className="text-purple-400 mt-0.5">ℹ️</span>
                    <div>
                        <h5 className="text-sm font-medium text-text-primary mb-1">Configuration Required</h5>
                        <p className="text-xs text-text-secondary">
                            Ensure that the Server URL and API Key are properly configured in the dedicated <strong className="text-text-primary">Server</strong> tab in the sidebar menu. Settings must be saved.
                        </p>
                    </div>
                </div>
            </div>
        </fieldset>
    );
};

export default ServerModelSettings;
