/**
 * Returns a function that is true only when a modal goes from closed to open.
 * The settings screen copies the saved settings into its local state at that moment and
 * never again while it stays open: App re-renders (toasts, memories, app resume) must not
 * wipe unsaved edits.
 */
export function createOpenGate(): (isOpen: boolean) => boolean {
    let wasOpen = false;
    return (isOpen: boolean) => {
        const opened = isOpen && !wasOpen;
        wasOpen = isOpen;
        return opened;
    };
}

/**
 * Picks the OpenRouter key: it is stored in llmConfig (encrypted by the secret store);
 * the top-level field is the old place it was edited from.
 */
export function initialOpenRouterKey(llmConfigKey: string | undefined, legacyKey: string | undefined): string {
    return llmConfigKey ?? legacyKey ?? '';
}
