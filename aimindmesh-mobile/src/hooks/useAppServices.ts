import { useEffect, useRef } from 'react';
import { logger } from '../services/logger';
import { MemoryExtractionService } from '../services/memory/memoryExtractionService';
import { proactiveService } from '../services/proactive/ProactiveService';

export const useAppServices = (
    chat: any,
    llmConfig: any,
    isAppActive: boolean,
    apiKey: string,
    perplexityApiKey: string,
    claudeApiKey: string,
    personality: any,
    addMemory: any,
    activeThreadIdState: string | null,
    showToast: any
) => {
    // --- Proactive Service Init ---
    useEffect(() => {
        proactiveService.init().catch(err => logger.log('error', 'Failed to init proactive service', err));
    }, []);

    // --- Automatic Memory Extraction ---
    const prevIsLoadingRef = useRef(chat.isLoading);

    useEffect(() => {
        const wasLoading = prevIsLoadingRef.current;
        const isNowLoading = chat.isLoading;
        prevIsLoadingRef.current = isNowLoading;

        if (wasLoading && !isNowLoading && chat.messages.length >= 2) {
            const lastMsg = chat.messages[chat.messages.length - 1];
            if (lastMsg.role === 'model' && lastMsg.text && !lastMsg.text.startsWith('Sorry, I encountered')) {
                const runExtraction = async () => {
                    if (!isAppActive && !llmConfig.keepAlive) {
                        logger.log('debug', '[App] Memory extraction skipped: App not active and keepAlive false');
                        return;
                    }

                    // Protect local model KV cache and battery (LiteRT and GGUF)
                    if (llmConfig.provider === 'litert' || llmConfig.provider === 'native-gguf') {
                        logger.log('info', '[App] Skipping Memory Extraction because a local model is active (prevents KV cache destruction and UI freeze).');
                        return;
                    }

                    const effectiveApiKey = llmConfig.provider === 'perplexity' ? perplexityApiKey : (llmConfig.provider === 'claude' ? claudeApiKey : apiKey);
                    if (['gemini', 'perplexity', 'claude'].includes(llmConfig.provider) && !effectiveApiKey) {
                        logger.log('warn', `[App] Memory extraction skipped: Missing API key for provider ${llmConfig.provider}`);
                        return;
                    }

                    try {
                        const extractor = new MemoryExtractionService(llmConfig, effectiveApiKey || '');
                        if (llmConfig.enableSemanticMemory && llmConfig.embeddingModelId && activeThreadIdState) {
                            const { getOrInitializeSemanticMemoryRetriever } = await import('../services/memory/semanticMemoryRetriever');
                            const retriever = await getOrInitializeSemanticMemoryRetriever(llmConfig);

                            if (retriever) {
                                await extractor.extractAndSaveMemory(chat.messages, personality, async (content, _category) => {
                                    await retriever.saveMessage(activeThreadIdState, 'extracted', content);
                                    logger.log('info', `[App] Saved extracted fact to semantic DB: "${content.substring(0, 50)}..."`);
                                });
                            } else {
                                logger.log('warn', '[App] Semantic memory retriever not available, skipping extraction');
                            }
                        } else {
                            await extractor.extractAndSaveMemory(chat.messages, personality, addMemory);
                        }
                    } catch (e) {
                        logger.log('warn', '[App] Memory extraction failed', e);
                    }
                };

                setTimeout(runExtraction, 2000);
            }
        }
    }, [chat.isLoading, chat.messages, isAppActive, llmConfig, apiKey, perplexityApiKey, claudeApiKey, personality, addMemory, activeThreadIdState]);

    // --- Memory Summarization ---
    useEffect(() => {
        const checkAndSummarize = async () => {
            if (!isAppActive) return;
            if (!llmConfig.enableSemanticMemory || !llmConfig.enableMemorySummarization) return;
            if (!apiKey && !perplexityApiKey && !claudeApiKey && llmConfig.provider !== 'local' && llmConfig.provider !== 'native-gguf') return;

            // Protect local model KV cache and battery
            if (llmConfig.provider === 'litert' || llmConfig.provider === 'native-gguf') {
                // logger.log('debug', '[App] Skipping Memory Summarization because a local model is active (prevents KV cache destruction).');
                return;
            }

            const lastRun = localStorage.getItem('last-memory-summary-run');
            const now = Date.now();
            if (lastRun && now - parseInt(lastRun) < 24 * 60 * 60 * 1000) {
                return;
            }

            logger.log('info', '[App] Running periodic memory summarization...');
            try {
                const { MemorySummarizer } = await import('../services/memory/memorySummarizer');
                const effectiveKey = llmConfig.provider === 'perplexity' ? perplexityApiKey : (llmConfig.provider === 'claude' ? claudeApiKey : apiKey);

                const summarizer = new MemorySummarizer(llmConfig, effectiveKey || '');
                const result = await summarizer.summarizeMemories(20);

                if (result.success) {
                    logger.log('info', '[App] Summarization complete:', result.message);
                    localStorage.setItem('last-memory-summary-run', now.toString());
                    showToast('Memories auto-summarized', 'info');
                } else {
                    logger.log('debug', '[App] Summarization skipped/failed:', result.message);
                }
            } catch (e) {
                logger.log('error', '[App] Summarization error', e);
            }
        };

        const timer = setTimeout(checkAndSummarize, 5000);
        return () => clearTimeout(timer);
    }, [isAppActive, llmConfig, apiKey, perplexityApiKey, claudeApiKey, showToast]);
};
