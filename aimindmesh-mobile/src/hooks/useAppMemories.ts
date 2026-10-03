import { useCallback } from 'react';
import { useLocalStorage } from './useLocalStorage';
import { Memory, DEFAULT_MEMORY_CATEGORIES, AIMindMeshServerSettings } from '../types';
import { syncSingleMemoryToServer } from '../services/memory/memorySyncService';
import { mergeImportedMemories, newMemoryId, normalizeCategory, updateCategory, withCategory } from '../services/memory/manualMemories';
import { exportMemoriesToFile, importMemoriesFromFile } from '../services/memory/memoryBackup';

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

    const addMemory = useCallback((content: string, category: string = 'other') => {
        const memoryCategory = normalizeCategory(category);
        const newMemory: Memory = {
            id: newMemoryId(),
            content: content,
            category: memoryCategory,
            timestamp: new Date()
        };
        setMemories(prev => [...prev, newMemory]);
        // A category chosen by the model ("general", ...) is listed, so the memory is visible
        setMemoryCategories(prev => withCategory(prev, memoryCategory));
        showToast('Memory added', 'success');

        // v4.0.0 — Auto-sync to server KG (fire-and-forget)
        if (autoSyncNewMemories && serverSettings?.enabled) {
            syncSingleMemoryToServer(newMemory, serverSettings);
        }
    }, [setMemories, setMemoryCategories, showToast, autoSyncNewMemories, serverSettings]);

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
        // Its memories move to "other" instead of disappearing from the list
        setMemories(prev => prev.map(m => m.category === category ? { ...m, category: 'other' } : m));
    }, [setMemoryCategories, setMemories]);

    /** (memoryId, newCategory) moves a memory; (oldCategory, newCategory) renames a category */
    const updateMemoryCategory = useCallback((idOrCategory: string, newCat: string) => {
        const updated = updateCategory(memories, memoryCategories, idOrCategory, newCat);
        setMemories(updated.memories);
        setMemoryCategories(updated.categories);
    }, [memories, memoryCategories, setMemoryCategories, setMemories]);

    const exportMemories = useCallback(async () => {
        try {
            const filename = await exportMemoriesToFile(memories, memoryCategories);
            showToast(`Backup saved to Documents/${filename}`, 'success');
        } catch (e: any) {
            showToast(e?.message || 'Export failed', 'error');
        }
    }, [memories, memoryCategories, showToast]);

    const importMemories = useCallback(async () => {
        try {
            const backup = await importMemoriesFromFile();
            if (!backup) return;
            const merged = mergeImportedMemories(memories, backup.memories);
            const added = merged.length - memories.length;
            setMemories(merged);
            setMemoryCategories(prev => [...backup.categories, ...merged.map(m => m.category)].map(normalizeCategory).reduce(withCategory, prev));
            showToast(`Imported ${added} memories`, 'success');
        } catch (e: any) {
            showToast(e?.message || 'Import failed', 'error');
        }
    }, [memories, setMemories, setMemoryCategories, showToast]);

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
