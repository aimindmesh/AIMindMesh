import { Capacitor } from '@capacitor/core';
import Performance from '../performancePlugin';
import { logger } from '../logger';

/** Window event MainActivity dispatches when the app is opened as the assistant */
export const ASSISTANT_LAUNCH_EVENT = 'assistantLaunch';

/**
 * True when the app was opened by the assistant gesture or the wake word session and
 * voice mode should open. The request is read once (MainActivity keeps it until then),
 * so the event and the check at startup never open voice mode twice.
 */
export async function consumeAssistantLaunch(): Promise<boolean> {
    if (Capacitor.getPlatform() !== 'android') return false;
    try {
        const { action } = await Performance.consumeLaunchAction();
        return action === 'voice';
    } catch (e) {
        logger.log('warn', '[AssistantLaunch] Launch action unavailable', e);
        return false;
    }
}
