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
}
