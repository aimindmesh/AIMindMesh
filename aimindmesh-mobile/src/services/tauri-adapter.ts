import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { isDesktop } from '../utils/platform';

// Removed floating block

/**
 * Adapter to interface with Tauri backend commands.
 * This class should only be used when isDesktop() is true.
 */
export class TauriAdapter {
    /**
     * Invoke a Tauri command.
     */
    static async invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
        if (!isDesktop()) {
            console.warn(`[TauriAdapter] Attempted to invoke '${cmd}' on non-desktop platform.`);
            throw new Error('TauriAdapter can only be used on Desktop');
        }
        try {
            return await invoke<T>(cmd, args);
        } catch (error) {
            console.error(`[TauriAdapter] Command '${cmd}' failed:`, error);
            throw error;
        }
    }

    /**
     * Listen to a Tauri event.
     */
    static async listen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
        if (!isDesktop()) {
            return () => { };
        }
        return listen<T>(event, (e) => handler(e.payload));
    }

    // =========================================================================
    // Command Namespaces
    // =========================================================================

    static LLM = {
        initModel: (options: { modelPath: string; nCtx: number; nThreads: number; useMmap: boolean; useFlashAttn: boolean }) =>
            TauriAdapter.invoke('llm_init_model', options),

        generate: (options: { prompt: string; maxTokens: number; temperature: number; topP: number }) =>
            TauriAdapter.invoke<string>('llm_generate', options),

        unload: () => TauriAdapter.invoke('llm_unload'),
    };

    static Audio = {
        loadWhisper: (options: { modelPath: string }) =>
            TauriAdapter.invoke('whisper_load_model', options),

        transcribe: (options: { audioPath: string; language?: string }) =>
            TauriAdapter.invoke<string>('whisper_transcribe', options),

        speak: (options: { text: string; voice?: string }) =>
            TauriAdapter.invoke('tts_speak', options),
    };

    static Memory = {
        saveVector: (options: { text: string; category: string }) =>
            TauriAdapter.invoke('memory_save_vector', options),

        search: (options: { query: string; limit: number }) =>
            TauriAdapter.invoke('memory_search', options),
    };

    static System = {
        executeCommand: (cmd: string) => TauriAdapter.invoke('execute_shell_command', { cmd }),
        getClipboard: async () => {
            if (!isDesktop()) return '';
            const { readText } = await import('@tauri-apps/plugin-clipboard-manager');
            return await readText();
        },
        setClipboard: async (text: string) => {
            if (!isDesktop()) return;
            const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
            await writeText(text);
        }
    };
}
