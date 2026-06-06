/**
 * Termux Plugin Service for AI Mind Mesh
 * 
 * Provides shell command execution via Termux:API.
 * Requires the Termux and Termux:API apps to be installed on the device.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { logger } from './logger';

// Define the plugin interface inline to avoid build issues
export interface TermuxCommandResult {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
}

interface TermuxPlugin {
    executeCommand(options: { command: string; background?: boolean }): Promise<TermuxCommandResult>;
    isAvailable(): Promise<{ available: boolean }>;
    openUrl(options: { url: string }): Promise<void>;
    showToast(options: { message: string; short?: boolean }): Promise<void>;
    vibrate(options: { duration?: number }): Promise<void>;
}

// Register the native plugin
const Termux = registerPlugin<TermuxPlugin>('Termux');

/**
 * Execute a shell command via Termux:API
 * Uses the native Termux Capacitor plugin
 */
export async function executeTermuxCommand(command: string, background: boolean = false): Promise<TermuxCommandResult> {
    if (!Capacitor.isNativePlatform()) {
        // On web, we can't execute Termux commands
        return {
            success: false,
            stdout: '',
            stderr: 'Termux commands are only available on Android',
            exitCode: -1
        };
    }

    try {
        logger.log('info', `Executing Termux command: ${command}`, { background });

        const result = await Termux.executeCommand({
            command,
            background
        });

        // Normalize result with default values for missing fields
        const normalizedResult: TermuxCommandResult = {
            success: result.success ?? false,
            stdout: result.stdout ?? '',
            stderr: result.stderr ?? '',
            exitCode: result.exitCode ?? -1
        };

        logger.log('info', 'Termux command result', {
            success: normalizedResult.success,
            exitCode: normalizedResult.exitCode,
            stdoutLength: normalizedResult.stdout.length,
            stderrLength: normalizedResult.stderr.length
        });

        return normalizedResult;
    } catch (error) {
        logger.log('error', 'Termux command execution failed', error);
        return {
            success: false,
            stdout: '',
            stderr: error instanceof Error ? error.message : 'Unknown error',
            exitCode: -1
        };
    }
}

/**
 * Check if Termux:API is available on the device
 */
export async function isTermuxAvailable(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) {
        return false;
    }

    try {
        const result = await Termux.isAvailable();
        return result.available;
    } catch (error) {
        logger.log('warn', 'Failed to check Termux availability', error);
        return false;
    }
}

/**
 * Open a URL using Termux's termux-open-url command
 */
export async function openUrlViaTermux(url: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
        throw new Error('Termux is only available on Android');
    }

    await Termux.openUrl({ url });
}

/**
 * Show a toast notification via Termux:API
 */
export async function showTermuxToast(message: string, short: boolean = true): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
        throw new Error('Termux is only available on Android');
    }

    await Termux.showToast({ message, short });
}
