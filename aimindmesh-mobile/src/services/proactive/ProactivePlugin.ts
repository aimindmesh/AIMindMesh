import { registerPlugin } from '@capacitor/core';

export interface ProactivePluginConfig {
    startService(): Promise<void>;
    stopService(): Promise<void>;
    updateSettings(options: { settings: string }): Promise<void>;
}

const ProactivePlugin = registerPlugin<ProactivePluginConfig>('Proactive');

export default ProactivePlugin;
