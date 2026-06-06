import { useCallback } from 'react';
import { useLocalStorage } from './useLocalStorage';
import { Memory, DEFAULT_MEMORY_CATEGORIES, AIMindMeshServerSettings } from '../types';
import { syncSingleMemoryToServer } from '../services/memory/memorySyncService';

interface UseAppMemoriesOptions {
    showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
    serverSettings?: AIMindMeshServerSettings;
    autoSyncNewMemories?: boolean;
}

export const useAppMemories = (
    showToastOrOptions: ((message: string, type?: 'success' | 'error' | 'info') => void) | UseAppMemoriesOptions
) => {
    // Support both legacy signature (function) and new options object
    const opts: UseAppMemoriesOptions = typeof showToastOrOptions === 'function'
        ? { showToast: showToastOrOptions }
        : showToastOrOptions;

    const { showToast, serverSettings, autoSyncNewMemories } = opts;

    const [memories, setMemories] = useLocalStorage<Memory[]>('companion-memories', []);
    const [memoryCategories, setMemoryCategories] = useLocalStorage<string[]>('memory-categories', [...DEFAULT_MEMORY_CATEGORIES]);
    const [enableAiMemoryCategorization, setEnableAiMemoryCategorization] = useLocalStorage<boolean>('enable-ai-memory-categorization', false);

    const addMemory = useCallback((content: string, category: string = 'general') => {
        const newMemory: Memory = {
            id: Date.now().toString(),
            content: content,
            category,
            timestamp: new Date()
        };
        setMemories(prev => [...prev, newMemory]);
        showToast('Memory added', 'success');

        // v4.0.0 — Auto-sync to server KG (fire-and-forget)
        if (autoSyncNewMemories && serverSettings?.enabled) {
            syncSingleMemoryToServer(newMemory, serverSettings);
        }
    }, [setMemories, showToast, autoSyncNewMemories, serverSettings]);

    const deleteMemory = useCallback((id: string) => {
        setMemories(prev => prev.filter(m => m.id !== id));
        showToast('Memory deleted', 'info');
    }, [setMemories, showToast]);

    const clearMemories = useCallback(() => {
        setMemories([]);
        showToast('Memories cleared', 'info');
    }, [setMemories, showToast]);

    const addMemoryCategory = useCallback((category: string) => {
        if (!memoryCategories.includes(category)) {
            setMemoryCategories(prev => [...prev, category]);
        }
    }, [memoryCategories, setMemoryCategories]);

    const deleteMemoryCategory = useCallback((category: string) => {
        setMemoryCategories(prev => prev.filter(c => c !== category));
    }, [setMemoryCategories]);

    const updateMemoryCategory = useCallback((oldCat: string, newCat: string) => {
        setMemoryCategories(prev => prev.map(c => c === oldCat ? newCat : c));
        setMemories(prev => prev.map(m => m.category === oldCat ? { ...m, category: newCat } : m));
    }, [setMemoryCategories, setMemories]);

    const exportMemories = useCallback(async () => {
        showToast('Export not fully implemented in refactor', 'info');
    }, [showToast]);

    const importMemories = useCallback(async () => {
        showToast('Import not fully implemented in refactor', 'info');
    }, [showToast]);

    return {
        memories,
        setMemories,
        memoryCategories,
        setMemoryCategories,
        enableAiMemoryCategorization,
        setEnableAiMemoryCategorization,
        addMemory,
        deleteMemory,
        clearMemories,
        addMemoryCategory,
        deleteMemoryCategory,
        updateMemoryCategory,
        exportMemories,
        importMemories
    };
};
