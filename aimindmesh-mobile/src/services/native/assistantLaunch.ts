import { Capacitor } from '@capacitor/core';
import Performance from '../performancePlugin';
import { logger } from '../logger';

/** Window event MainActivity dispatches when a launch action is pending (assistant, feed notification) */
export const ASSISTANT_LAUNCH_EVENT = 'assistantLaunch';

/**
 * Action the app was opened for, read once (MainActivity keeps it until then, so the event and
 * the check at startup never act twice): 'voice' (assistant gesture or wake word session),
 * 'feed' or 'feed:<insightId>' (a feed notification), null otherwise.
 */
export async function consumeLaunchAction(): Promise<string | null> {
    if (Capacitor.getPlatform() !== 'android') return null;
    try {
        const { action } = await Performance.consumeLaunchAction();
        return action || null;
    } catch (e) {
        logger.log('warn', '[AssistantLaunch] Launch action unavailable', e);
        return null;
    }
}

/** Window event asking App to show the Feed (detail: insight id or undefined) */
export const OPEN_FEED_EVENT = 'openFeed';
