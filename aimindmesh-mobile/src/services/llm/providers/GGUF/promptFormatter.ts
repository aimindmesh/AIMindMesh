import { Message } from '../../../../types';
import { logger } from '../../../logger';
import {
    formatGemmaPrompt,
    formatQwenPrompt,
    formatLlamaPrompt,
    formatMistralPrompt,
    formatZephyrPrompt,
    formatPhiPrompt
} from '../../promptFormatters';

export function formatPromptForModel(
    messages: Message[],
    systemPrompt: string,
    modelPath: string
): { prompt: string; stopTokens: string[] } {
    const p = modelPath.toLowerCase();
    const isGemma = p.includes('gemma');
    const isLlama = p.includes('llama');
    const isMistral = p.includes('mistral');
    const isZephyr = p.includes('zephyr');
    const isQwen = p.includes('qwen');
    const isSmolLM = p.includes('smollm');
    const isPhi = p.includes('phi');
    const isTinyLlama = p.includes('tinyllama');
    const isOpenChat = p.includes('openchat');
    const isVicuna = p.includes('vicuna');
    const isChatML = p.includes('chatml') || isQwen || isSmolLM;
    const isLlama3 = p.includes('llama-3') || p.includes('llama3');

    let fullPrompt = '';
    let stopTokens: string[] = [];

    if (isGemma) {
        const res = formatGemmaPrompt(messages, systemPrompt, false);
        fullPrompt = res.prompt;
        stopTokens = res.stopTokens;
    } else if (isPhi) {
        const res = formatPhiPrompt(messages, systemPrompt, false);
        fullPrompt = res.prompt;
        stopTokens = res.stopTokens;
    } else if (isTinyLlama) {
        const res = formatLlamaPrompt(messages, systemPrompt, false);
        fullPrompt = res.prompt;
        stopTokens = res.stopTokens;
    } else if (isMistral) {
        const res = formatMistralPrompt(messages, systemPrompt, false);
        fullPrompt = res.prompt;
        stopTokens = res.stopTokens;
    } else if (isOpenChat) {
        const res = formatZephyrPrompt(messages, systemPrompt, false);
        fullPrompt = res.prompt;
        stopTokens = res.stopTokens;
    } else if (isVicuna) {
        const res = formatLlamaPrompt(messages, systemPrompt, false);
        fullPrompt = res.prompt;
        stopTokens = res.stopTokens;
    } else if (isLlama3 || isLlama) {
        const res = formatLlamaPrompt(messages, systemPrompt, false, isLlama3);
        fullPrompt = res.prompt;
        stopTokens = res.stopTokens;
    } else if (isChatML) {
        const res = formatQwenPrompt(messages, systemPrompt, false);
        fullPrompt = res.prompt;
        stopTokens = res.stopTokens;
    } else if (isZephyr) {
        const res = formatZephyrPrompt(messages, systemPrompt, false);
        fullPrompt = res.prompt;
        stopTokens = res.stopTokens;
    } else {
        // Default fallback to ChatML
        const res = formatQwenPrompt(messages, systemPrompt, false);
        fullPrompt = res.prompt;
        stopTokens = res.stopTokens;
    }

    logger.log('debug', 'Native GGUF Prompt:', fullPrompt);
    return { prompt: fullPrompt, stopTokens };
}
