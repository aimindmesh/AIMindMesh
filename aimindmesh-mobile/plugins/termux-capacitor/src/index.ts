import { registerPlugin } from '@capacitor/core';

export interface TermuxCommandResult {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
}

export interface TermuxPlugin {
    /**
     * Execute a shell command via Termux:API
     * Requires Termux:API app to be installed
     */
    executeCommand(options: {
        command: string;
        background?: boolean;
    }): Promise<TermuxCommandResult>;

    /**
     * Check if Termux:API is available on the device
     */
    isAvailable(): Promise<{ available: boolean }>;

    /**
     * Open a URL in Termux browser (termux-open-url)
     */
    openUrl(options: { url: string }): Promise<void>;

    /**
     * Show a toast notification via Termux
     */
    showToast(options: { message: string; short?: boolean }): Promise<void>;

    /**
     * Vibrate the device via Termux
     */
    vibrate(options: { duration?: number }): Promise<void>;
}

const Termux = registerPlugin<TermuxPlugin>('Termux');

export default Termux;
