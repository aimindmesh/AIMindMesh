import { Capacitor } from '@capacitor/core';
import BackgroundService from 'background-service-capacitor';
import { logger } from '../logger';

let startedByMeeting = false;
let meetingRecording = false;

/** True while a meeting records: keep-alive must not stop the shared service meanwhile. */
export function isMeetingRecording(): boolean {
    return meetingRecording;
}

/**
 * Android silences the microphone of apps in background: without a microphone foreground service
 * a meeting recorded with the screen off (or after the screen times out) is silence. Called once
 * recording has started, so RECORD_AUDIO is granted and the service gets the microphone type
 * (starting it again upgrades a keep-alive instance that was started without it).
 */
export async function startMeetingForegroundService(): Promise<void> {
    if (Capacitor.getPlatform() !== 'android') return;
    meetingRecording = true;
    try {
        const { running } = await BackgroundService.isRunning();
        await BackgroundService.startService({
            title: 'AI Mind Mesh',
            body: 'Recording a meeting'
        });
        // A service already running belongs to keep-alive: it must survive the meeting
        startedByMeeting = !running;
    } catch (error) {
        logger.log('warn', '[Meeting] Foreground service not started: recording may stop with the screen off', error);
    }
}

export async function stopMeetingForegroundService(): Promise<void> {
    meetingRecording = false;
    if (!startedByMeeting) return;
    startedByMeeting = false;
    try {
        await BackgroundService.stopService();
    } catch (error) {
        logger.log('warn', '[Meeting] Failed to stop the foreground service', error);
    }
}
