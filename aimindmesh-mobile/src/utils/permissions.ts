import { Capacitor } from '@capacitor/core';

/**
 * Request microphone permission for audio recording
 * 
 * On Android, this will trigger the system permission dialog if not already granted.
 * On Web, getUserMedia will handle permissions automatically.
 * 
 * @returns Promise<boolean> - true if permission granted, false otherwise
 */
export async function requestMicrophonePermission(): Promise<boolean> {
    try {
        // On web, getUserMedia handles permissions automatically
        if (!Capacitor.isNativePlatform()) {
            console.log('[Permissions] Web platform - getUserMedia will handle permissions');
            return true;
        }

        // On Android, we need to request RECORD_AUDIO permission
        // Capacitor doesn't have a dedicated microphone permission API,
        // but we can use the Android PermissionManager directly via a plugin call

        // First, try to access the microphone to trigger permission request
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            // If we get here, permission was granted
            stream.getTracks().forEach(track => track.stop()); // Clean up
            console.log('[Permissions] Microphone permission granted');
            return true;
        } catch (error: any) {
            console.error('[Permissions] Microphone permission denied or error:', error);

            // Check if it's a permission error
            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                return false;
            }

            // Other errors (e.g., no microphone available)
            throw error;
        }
    } catch (error) {
        console.error('[Permissions] Error requesting microphone permission:', error);
        return false;
    }
}

/**
 * Check if microphone permission is already granted
 * 
 * @returns Promise<boolean> - true if permission granted, false otherwise
 */
export async function checkMicrophonePermission(): Promise<boolean> {
    try {
        if (!Capacitor.isNativePlatform()) {
            // On web, we can't check without requesting
            return true;
        }

        // Try to enumerate devices to check permission status
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasAudioInput = devices.some(device => device.kind === 'audioinput' && device.label !== '');

        console.log('[Permissions] Microphone permission check:', hasAudioInput);
        return hasAudioInput;
    } catch (error) {
        console.error('[Permissions] Error checking microphone permission:', error);
        return false;
    }
}
