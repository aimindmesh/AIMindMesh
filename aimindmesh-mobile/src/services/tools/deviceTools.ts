/**
 * Device Control Tool Implementations
 */

import { executeTermuxCommand } from '../termuxPlugin';
import { ToolResult } from './types';
import { shellQuote, clampInt } from './shellArgs';

// Model-supplied values reach `sh -c`: only known words and clamped numbers are interpolated
const VOLUME_STREAMS = ['alarm', 'music', 'notification', 'ring', 'system', 'call'];
const LOCATION_PROVIDERS = ['gps', 'network', 'passive'];

export async function executeSetVolume(args: Record<string, unknown>): Promise<ToolResult> {
    const stream = String(args.stream ?? '').toLowerCase();
    const level = clampInt(args.level, 0, 100, NaN);

    if (!stream || Number.isNaN(level)) {
        return { success: false, message: 'Stream and level are required' };
    }
    if (!VOLUME_STREAMS.includes(stream)) {
        return { success: false, message: `Unknown volume stream "${stream}". Use one of: ${VOLUME_STREAMS.join(', ')}` };
    }

    const cmd = `termux-volume ${stream} ${level}`;
    const result = await executeTermuxCommand(cmd);

    if (result.success || result.exitCode === 0) {
        return {
            success: true,
            message: `Set ${stream} volume to ${level}`,
            data: { stream, level }
        };
    } else {
        return {
            success: false,
            message: `Failed to set volume: ${result.stderr || 'Unknown error'}`
        };
    }
}

export async function executeSetBrightness(args: Record<string, unknown>): Promise<ToolResult> {
    const level = Number(args.level);

    if (args.level === undefined || !Number.isFinite(level) || level < 0 || level > 255) {
        return { success: false, message: 'Brightness level must be between 0 and 255' };
    }

    const cmd = `termux-brightness ${Math.round(level)}`;
    const result = await executeTermuxCommand(cmd);

    if (result.success || result.exitCode === 0) {
        return {
            success: true,
            message: `Set brightness to ${level}`,
            data: { level }
        };
    } else {
        return {
            success: false,
            message: `Failed to set brightness: ${result.stderr || 'Unknown error'}`
        };
    }
}

export async function executeToggleWifi(args: Record<string, unknown>): Promise<ToolResult> {
    const raw = args.enabled;
    if (raw === undefined) {
        return { success: false, message: 'Enabled parameter is required (true/false)' };
    }
    const enabled = raw === true || raw === 'true';

    const cmd = `termux-wifi-enable ${enabled}`;
    const result = await executeTermuxCommand(cmd);

    if (result.success || result.exitCode === 0) {
        return {
            success: true,
            message: `WiFi ${enabled ? 'enabled' : 'disabled'}`,
            data: { enabled }
        };
    } else {
        return {
            success: false,
            message: `Failed to toggle WiFi: ${result.stderr || 'Unknown error'}`
        };
    }
}

export async function executeGetLocation(args: Record<string, unknown>): Promise<ToolResult> {
    const requested = String(args.provider || 'gps').toLowerCase();
    const provider = LOCATION_PROVIDERS.includes(requested) ? requested : 'gps';

    const cmd = `termux-location -p ${shellQuote(provider)}`;
    const result = await executeTermuxCommand(cmd);

    if (result.success && result.stdout) {
        try {
            const location = JSON.parse(result.stdout);
            return {
                success: true,
                message: `Location: ${location.latitude}, ${location.longitude}`,
                data: location
            };
        } catch {
            return {
                success: true,
                message: `Location data: ${result.stdout}`,
                data: { raw: result.stdout }
            };
        }
    } else {
        return {
            success: false,
            message: `Failed to get location: ${result.stderr || 'Location services may be disabled'}`
        };
    }
}
