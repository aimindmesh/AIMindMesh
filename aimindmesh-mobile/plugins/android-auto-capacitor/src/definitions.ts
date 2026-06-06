export interface AndroidAutoPlugin {
    initialize(): Promise<void>;
    startSession(): Promise<void>;
    updateScreen(options: { type: string, payload: string }): Promise<void>;
    updateSettings(settings: {
        enabled: boolean;
        showCallMode: boolean;
        showCalendar: boolean;
        showToDo: boolean;
        showKanban: boolean;
    }): Promise<void>;
}
