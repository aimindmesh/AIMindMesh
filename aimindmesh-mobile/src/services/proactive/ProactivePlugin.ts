import { registerPlugin } from '@capacitor/core';

export interface ProactivePluginConfig {
    startService(): Promise<void>;
    stopService(): Promise<void>;
    updateSettings(options: { settings: string }): Promise<void>;
    /** Server settings for the native ProactiveWorker (it cannot read localStorage) */
    syncServerConfig(options: {
        enabled: boolean;
        serverUrl: string;
        deliveryMode: 'PUSH' | 'CONTEXTUAL';
        deviceId: string;
        /** Only without an encrypted secret store: otherwise the worker reads it from the Keystore */
        apiKey?: string;
    }): Promise<void>;
}

const ProactivePlugin = registerPlugin<ProactivePluginConfig>('Proactive');

export default ProactivePlugin;
