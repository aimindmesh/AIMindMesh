/**
 * App Launcher Tool Implementations
 */

import { executeTermuxCommand } from '../termuxPlugin';
import { ToolResult } from './types';
import { shellQuote, clampInt } from './shellArgs';

// Common app package names for quick lookup
export const APP_PACKAGES: Record<string, string> = {
    'youtube': 'com.google.android.youtube',
    'spotify': 'com.spotify.music',
    'whatsapp': 'com.whatsapp',
    'telegram': 'org.telegram.messenger',
    'instagram': 'com.instagram.android',
    'facebook': 'com.facebook.katana',
    'twitter': 'com.twitter.android',
    'x': 'com.twitter.android',
    'chrome': 'com.android.chrome',
    'gmail': 'com.google.android.gm',
    'maps': 'com.google.android.apps.maps',
    'photos': 'com.google.android.apps.photos',
    'calendar': 'com.google.android.calendar',
    'drive': 'com.google.android.apps.docs',
    'settings': 'com.android.settings',
    'camera': 'com.android.camera',
    'clock': 'com.android.deskclock',
    'calculator': 'com.android.calculator2',
    'netflix': 'com.netflix.mediaclient',
    'tiktok': 'com.zhiliaoapp.musically',
    'snapchat': 'com.snapchat.android',
    'reddit': 'com.reddit.frontpage',
    'discord': 'com.discord',
    'slack': 'com.Slack',
    'teams': 'com.microsoft.teams',
    'zoom': 'us.zoom.videomeetings',
    'amazon': 'com.amazon.mShop.android.shopping',
    'uber': 'com.ubercab',
    'google': 'com.google.android.googlequicksearchbox',
};

export async function executeLaunchApp(args: Record<string, unknown>): Promise<ToolResult> {
    const appName = (args.app_name as string)?.toLowerCase();
    let packageName = args.package_name as string;

    if (!appName && !packageName) {
        return { success: false, message: 'App name or package name is required' };
    }

    // Look up package name if not provided
    if (!packageName && appName) {
        packageName = APP_PACKAGES[appName] || '';
    }

    // Names come from the model and reach sh -c: quoted
    let cmd: string;
    if (packageName) {
        // Launch by package name
        cmd = `am start -n ${shellQuote(`${packageName}/.MainActivity`)} 2>/dev/null || am start -a android.intent.action.MAIN -p ${shellQuote(packageName)}`;
    } else {
        // Try to launch by app name using monkey
        cmd = `monkey -p ${shellQuote(appName)} -c android.intent.category.LAUNCHER 1 2>/dev/null || echo "App not found"`;
    }

    const result = await executeTermuxCommand(cmd);

    if (result.success || result.exitCode === 0) {
        return {
            success: true,
            message: `Launched ${appName || packageName}`,
            data: { appName, packageName }
        };
    } else {
        return {
            success: false,
            message: `Could not launch app: ${result.stderr || 'App not found or not installed'}`
        };
    }
}

export async function executeCreateKeepNote(args: Record<string, unknown>): Promise<ToolResult> {
    const title = (args.title as string) || '';
    const content = args.content as string;

    if (!content) {
        return { success: false, message: 'Note content is required' };
    }

    const cmd = `am start -a android.intent.action.SEND -t "text/plain" -p com.google.android.keep -e "android.intent.extra.TEXT" ${shellQuote(content)} -e "android.intent.extra.SUBJECT" ${shellQuote(title)}`;

    const result = await executeTermuxCommand(cmd);

    if (result.success || result.exitCode === 0) {
        return {
            success: true,
            message: `Opened Google Keep with note: "${content.substring(0, 30)}..."`,
            data: { title, content }
        };
    } else {
        return {
            success: false,
            message: `Failed to open Keep: ${result.stderr || 'Unknown error'}`
        };
    }
}

export async function executeSetAlarm(args: Record<string, unknown>): Promise<ToolResult> {
    const hour = clampInt(args.hour, 0, 23, NaN);
    const minute = clampInt(args.minute, 0, 59, NaN);
    const message = (args.message as string) || 'AI Alarm';

    if (Number.isNaN(hour) || Number.isNaN(minute)) {
        return { success: false, message: 'Hour and minute are required' };
    }

    // --ei for integer extras
    const cmd = `am start -a android.intent.action.SET_ALARM --ei "android.intent.extra.alarm.HOUR" ${hour} --ei "android.intent.extra.alarm.MINUTES" ${minute} -e "android.intent.extra.alarm.MESSAGE" ${shellQuote(message)}`;

    const result = await executeTermuxCommand(cmd);

    if (result.success || result.exitCode === 0) {
        return {
            success: true,
            message: `Alarm set for ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
            data: { hour, minute, message }
        };
    } else {
        return {
            success: false,
            message: `Failed to set alarm: ${result.stderr || 'Unknown error'}`
        };
    }
}
