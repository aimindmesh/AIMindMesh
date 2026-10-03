export interface AudioOutputPlugin {
    /**
     * Set speaker phone on or off
     * @param options - { enabled: boolean }
     */
    setSpeakerphoneOn(options: { enabled: boolean }): Promise<void>;

    /**
     * Get current speakerphone status
     * @returns { enabled: boolean }
     */
    getSpeakerphoneStatus(): Promise<{ enabled: boolean }>;

    /**
     * Restore normal (non-call) audio routing: MODE_NORMAL, speakerphone off.
     * Call when a voice call ends, the mode is process-wide and otherwise persists.
     */
    resetAudioMode(): Promise<void>;
}
