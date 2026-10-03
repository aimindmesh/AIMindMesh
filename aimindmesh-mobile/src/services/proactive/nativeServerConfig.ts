import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { AIMindMeshServerSettings } from '../../types';
import { isSecureBackend } from '../security/secretStore';
import { logger } from '../logger';
import ProactivePlugin from './ProactivePlugin';

/**
 * Hands the server settings to the native ProactiveWorker (contextual delivery runs there,
 * also when the app is closed). The API key is passed only when there is no encrypted secret
 * store: otherwise the worker reads it from the Android Keystore itself.
 */
export async function syncNativeServerConfig(settings: AIMindMeshServerSettings): Promise<void> {
    if (Capacitor.getPlatform() !== 'android') return;
    try {
        await ProactivePlugin.syncServerConfig({
            enabled: !!settings.enabled,
            serverUrl: settings.serverUrl || '',
            deliveryMode: settings.deliveryMode === 'CONTEXTUAL' ? 'CONTEXTUAL' : 'PUSH',
            // Same id the server knows the device by (x-device-id of /api/delivery/*)
            deviceId: (await Device.getId()).identifier,
            apiKey: isSecureBackend() ? undefined : settings.apiKey || '',
        });
    } catch (e) {
        logger.log('warn', '[NativeServerConfig] Sync to the native worker failed', e);
    }
}
