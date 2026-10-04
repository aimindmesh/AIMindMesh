import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalStorage } from './useLocalStorage';
import { DEFAULT_MEMORY_CATEGORIES, AIMindMeshServerSettings } from '../types';
import { Fact, FactStatus, NewFact } from '../services/memory/facts/factTypes';
import { FactPatch, factStore } from '../services/memory/facts/factStore';
import { startFactSync } from '../services/memory/memorySyncService';
import { markFactsForReview } from '../services/memory/facts/factReview';
import { normalizeCategory, withCategory } from '../services/memory/manualMemories';
import { exportMemoriesToFile, importMemoriesFromFile } from '../services/memory/memoryBackup';
import { logger } from '../services/logger';

interface UseMemoryFactsOptions {
    showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
    serverSettings?: AIMindMeshServerSettings;
    autoSyncNewMemories?: boolean;
}

/**
 * The facts the assistant knows about the user, for the app and the settings: list, edit,
 * categories, backup, and the mirror on the server when auto-sync is on.
 */
export const useMemoryFacts = ({ showToast, serverSettings, autoSyncNewMemories }: UseMemoryFactsOptions) => {
    const [facts, setFacts] = useState<Fact[]>(() => factStore.isReady() ? factStore.list() : []);
    const [ready, setReady] = useState(factStore.isReady());
    const [memoryCategories, setMemoryCategories] = useLocalStorage<string[]>('memory-categories', [...DEFAULT_MEMORY_CATEGORIES]);
    const [enableAiMemoryCategorization, setEnableAiMemoryCategorization] = useLocalStorage<boolean>('enable-ai-memory-categorization', false);

    useEffect(() => {
        const unsubscribe = factStore.subscribe(list => { setFacts(list); setReady(true); });
        factStore.init()
            .then(() => markFactsForReview()) // once: old junk out of the prompt, for the user to decide
            .catch(e => logger.log('error', '[Memory] Facts not loaded', e));
        return unsubscribe;
    }, []);

    // Server mirror, with the latest settings
    const syncSettings = useRef<AIMindMeshServerSettings | null>(null);
    syncSettings.current = autoSyncNewMemories && serverSettings?.enabled ? serverSettings : null;
    useEffect(() => startFactSync(() => syncSettings.current), []);

    const addFact = useCallback(async (input: NewFact) => {
        // Told by the user in the settings: certain, and always in the profile unless said otherwise
        const result = await factStore.add({ source: 'manual', confidence: 1, pinned: true, ...input });
        if (!result) return;
        if (input.category) setMemoryCategories(prev => withCategory(prev, normalizeCategory(input.category)));
        showToast(result.duplicate ? 'Already known' : 'Memory added', 'success');
    }, [setMemoryCategories, showToast]);

    const updateFact = useCallback(async (id: string, patch: FactPatch) => {
        await factStore.update(id, patch);
        if (patch.category) setMemoryCategories(prev => withCategory(prev, normalizeCategory(patch.category)));
    }, [setMemoryCategories]);

    const setFactStatus = useCallback((id: string, status: FactStatus) => factStore.setStatus(id, status), []);

    const deleteFact = useCallback(async (id: string) => {
        await factStore.remove([id]);
        showToast('Memory deleted', 'info');
    }, [showToast]);

    /** Everything remembered: facts, conversation memories and their links */
    const clearAllMemories = useCallback(async () => {
        await factStore.clear();
        try {
            const { clearAllSemanticMemories } = await import('../services/memory/memoryDatabase');
            await clearAllSemanticMemories();
        } catch (e) {
            logger.log('warn', '[Memory] Conversation memories not cleared (no database on this platform?)', e);
        }
        showToast('All memories deleted', 'info');
    }, [showToast]);

    const addMemoryCategory = useCallback((category: string) => {
        setMemoryCategories(prev => withCategory(prev, normalizeCategory(category)));
    }, [setMemoryCategories]);

    const deleteMemoryCategory = useCallback(async (category: string) => {
        setMemoryCategories(prev => prev.filter(c => c !== category));
        // Its facts lose the label instead of disappearing
        for (const fact of factStore.list().filter(f => f.category === category)) {
            await factStore.update(fact.id, { category: undefined });
        }
    }, [setMemoryCategories]);

    const exportMemories = useCallback(async () => {
        try {
            const filename = await exportMemoriesToFile(factStore.list(), memoryCategories);
            showToast(`Backup saved to Documents/${filename}`, 'success');
        } catch (e: any) {
            showToast(e?.message || 'Export failed', 'error');
        }
    }, [memoryCategories, showToast]);

    const importMemories = useCallback(async () => {
        try {
            const backup = await importMemoriesFromFile();
            if (!backup) return;
            const added = await factStore.importFacts(backup.facts);
            setMemoryCategories(prev => [...backup.categories, ...backup.facts.map(f => f.category).filter(Boolean) as string[]]
                .map(normalizeCategory).reduce(withCategory, prev));
            showToast(`Imported ${added} memories`, 'success');
        } catch (e: any) {
            showToast(e?.message || 'Import failed', 'error');
        }
    }, [setMemoryCategories, showToast]);

    return {
        facts,
        ready,
        addFact,
        updateFact,
        setFactStatus,
        deleteFact,
        clearAllMemories,
        memoryCategories,
        addMemoryCategory,
        deleteMemoryCategory,
        exportMemories,
        importMemories,
        enableAiMemoryCategorization,
        setEnableAiMemoryCategorization,
    };
};

export type MemoryFactsApi = ReturnType<typeof useMemoryFacts>;
