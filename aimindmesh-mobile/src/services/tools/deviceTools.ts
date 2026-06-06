/**
 * Device Control Tool Implementations
 */

import { executeTermuxCommand } from '../termuxPlugin';
import { ToolResult } from './types';

export async function executeSetVolume(args: Record<string, unknown>): Promise<ToolResult> {
    const stream = args.stream as string;
    const level = args.level as number;

    if (!stream || level === undefined) {
        return { success: false, message: 'Stream and level are required' };
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
    const level = args.level as number;

    if (level === undefined || level < 0 || level > 255) {
        return { success: false, message: 'Brightness level must be between 0 and 255' };
    }

    const cmd = `termux-brightness ${level}`;
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
    const enabled = args.enabled as boolean;

    if (enabled === undefined) {
        return { success: false, message: 'Enabled parameter is required (true/false)' };
    }

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
    const provider = (args.provider as string) || 'gps';

    const cmd = `termux-location -p ${provider}`;
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
