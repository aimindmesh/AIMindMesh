/**
 * Prompt formatters for different GGUF model types
 */

import { Message } from '../../types';

export interface PromptResult {
    prompt: string;
    stopTokens: string[];
}

/**
 * Build message text with images for GGUF multimodal models.
 */
/**
 * Build message text with images for GGUF multimodal models.
 * Replaces debug [img] tags with actual model-specific vision tokens.
 */
export function buildMessageTextForGGUF(message: Message, supportsVision: boolean, modelFamily: 'llama' | 'qwen' | 'gemma' | 'other' = 'other'): string {
    let text = message.text;

    if (supportsVision && message.images && message.images.length > 0) {
        // We assume one image token per image for now, or just one header.
        // Most models just need the token(s) at the start or end.

        let visionTokens = '';
        message.images.forEach(() => {
            if (modelFamily === 'llama') {
                // Llama 3.2 Vision uses <|image|>
                visionTokens += '<|image|>\n';
            } else if (modelFamily === 'qwen') {
                // Qwen2-VL uses <|vision_start|><|image_pad|><|vision_end|>
                visionTokens += '<|vision_start|><|image_pad|><|vision_end|>';
            } else {
                // Default (LLaVA, Gemma usually references features or just implicit)
                // Using <image> is standard for LLaVA
                visionTokens += '<image>\n';
            }
        });

        text = `${visionTokens}\n${message.text}`;
    }

    return text;
}

/** Format prompt for Gemma models */
/** Format prompt for Gemma models */
export function formatGemmaPrompt(messagesToUse: Message[], systemPrompt: string, supportsVision: boolean): PromptResult {
    let fullPrompt = '';
    const modelFamily = 'gemma';

    if (messagesToUse.length > 0 && messagesToUse[0].role === 'user') {
        const firstMsg = messagesToUse[0];
        if (systemPrompt) {
            fullPrompt = `<start_of_turn>user\n${systemPrompt}\n\n${buildMessageTextForGGUF(firstMsg, supportsVision, modelFamily)}<end_of_turn>\n`;
        } else {
            fullPrompt = `<start_of_turn>user\n${buildMessageTextForGGUF(firstMsg, supportsVision, modelFamily)}<end_of_turn>\n`;
        }

        for (let i = 1; i < messagesToUse.length; i++) {
            const m = messagesToUse[i];
            const role = m.role === 'user' ? 'user' : 'model';
            fullPrompt += `<start_of_turn>${role}\n${buildMessageTextForGGUF(m, supportsVision, modelFamily)}<end_of_turn>\n`;
        }
    } else {
        // Fallback or empty history
        if (systemPrompt) {
            fullPrompt = `<start_of_turn>user\n${systemPrompt}<end_of_turn>\n`;
        }
        messagesToUse.forEach(m => {
            const role = m.role === 'user' ? 'user' : 'model';
            fullPrompt += `<start_of_turn>${role}\n${buildMessageTextForGGUF(m, supportsVision, modelFamily)}<end_of_turn>\n`;
        });
    }

    fullPrompt += `<start_of_turn>model\n`;
    return {
        prompt: fullPrompt,
        stopTokens: ['<end_of_turn>', '<start_of_turn>']
    };
}

/** Format prompt for Qwen/SmolLM models (ChatML format) */
/** Format prompt for Qwen/SmolLM models (ChatML format) */
export function formatQwenPrompt(messagesToUse: Message[], systemPrompt: string, supportsVision: boolean): PromptResult {
    let fullPrompt = '';
    if (systemPrompt) {
        fullPrompt = `<|im_start|>system\n${systemPrompt}<|im_end|>\n`;
    }
    const modelFamily = 'qwen';

    messagesToUse.forEach(m => {
        const role = m.role === 'user' ? 'user' : 'assistant';
        fullPrompt += `<|im_start|>${role}\n${buildMessageTextForGGUF(m, supportsVision, modelFamily)}<|im_end|>\n`;
    });

    fullPrompt += `<|im_start|>assistant\n`;
    return {
        prompt: fullPrompt,
        stopTokens: ['<|im_end|>', '<|im_start|>']
    };
}

/** Format prompt for Llama 2/3 models */
/** Format prompt for Llama 2/3 models */
export function formatLlamaPrompt(messagesToUse: Message[], systemPrompt: string, supportsVision: boolean, isLlama3 = false): PromptResult {
    let fullPrompt = '';

    // Check if we need to initialize with system prompt
    if (systemPrompt) {
        fullPrompt = `[INST] <<SYS>>\n${systemPrompt}\n<</SYS>>\n\n`;
    } else {
        // Start with [INST] if appending and starting fresh block
        fullPrompt = `[INST] `;
    }

    const modelFamily = isLlama3 ? 'llama' : 'other';

    messagesToUse.forEach((m, index) => {
        const text = buildMessageTextForGGUF(m, supportsVision, modelFamily);
        if (m.role === 'user') {
            if (index === 0 && (systemPrompt || fullPrompt === '[INST] ')) {
                fullPrompt += `${text} [/INST] `;
            } else {
                fullPrompt += `[INST] ${text} [/INST] `;
            }
        } else {
            fullPrompt += `${text} </s><s>[INST] `;
        }
    });

    // Remove trailing <s>[INST] if last was assistant
    if (fullPrompt.endsWith('<s>[INST] ')) {
        fullPrompt = fullPrompt.slice(0, -11); // remove </s><s>[INST] 
        fullPrompt += '</s>';
    } else if (fullPrompt.endsWith('[/INST] ')) {
        // Ends with user message, ready for model
    }

    return {
        prompt: fullPrompt,
        stopTokens: ['</s>', '[INST]', 'User:']
    };
}

/** Format prompt for Mistral models */
/** Format prompt for Mistral models */
export function formatMistralPrompt(messagesToUse: Message[], systemPrompt: string, supportsVision: boolean): PromptResult {
    let fullPrompt = '';
    if (systemPrompt) {
        fullPrompt = `[INST] ${systemPrompt}\n\n`;
    } else {
        fullPrompt = `[INST] `;
    }

    messagesToUse.forEach((m) => {
        if (m.role === 'user') {
            fullPrompt += `${buildMessageTextForGGUF(m, supportsVision, 'other')} [/INST] `;
        } else {
            fullPrompt += `${buildMessageTextForGGUF(m, supportsVision, 'other')} </s>[INST] `;
        }
    });

    return {
        prompt: fullPrompt,
        stopTokens: ['</s>', '[INST]']
    };
}

/** Format prompt for Zephyr models */
/** Format prompt for Zephyr models */
export function formatZephyrPrompt(messagesToUse: Message[], systemPrompt: string, supportsVision: boolean): PromptResult {
    let fullPrompt = '';
    if (systemPrompt) {
        fullPrompt = `<|system|>\n${systemPrompt}</s>\n`;
    }

    messagesToUse.forEach(m => {
        fullPrompt += `<|${m.role}|>\n${buildMessageTextForGGUF(m, supportsVision, 'other')}</s>\n`;
    });

    fullPrompt += `<|assistant|>\n`;
    return {
        prompt: fullPrompt,
        stopTokens: ['</s>', '<|user|>', '<|assistant|>']
    };
}

/** Format prompt for Phi-3 models */
/** Format prompt for Phi-3 models */
export function formatPhiPrompt(messagesToUse: Message[], systemPrompt: string, supportsVision: boolean): PromptResult {
    let fullPrompt = '';
    if (systemPrompt) {
        fullPrompt = `<s><|system|>\n${systemPrompt}<|end|>\n`;
    }

    messagesToUse.forEach(m => {
        fullPrompt += `<|${m.role}|>\n${buildMessageTextForGGUF(m, supportsVision, 'other')}<|end|>\n`;
    });

    fullPrompt += `<|assistant|>\n`;
    return {
        prompt: fullPrompt,
        stopTokens: ['<|end|>', '<|user|>', '<|assistant|>']
    };
}

/** Generic/Fallback prompt format */
/** Generic/Fallback prompt format */
export function formatGenericPrompt(messagesToUse: Message[], systemPrompt: string, supportsVision: boolean): PromptResult {
    const conversationHistory = messagesToUse.map(m =>
        `${m.role === 'user' ? 'User' : 'Assistant'}: ${buildMessageTextForGGUF(m, supportsVision, 'other')}`
    ).join('\n');

    const fullPrompt = `${systemPrompt}\n\n${conversationHistory}\nAssistant:`;

    return {
        prompt: fullPrompt,
        stopTokens: ['\nUser:', '\nuser:', '\nUSER:', 'User:', 'user:', 'USER:']
    };
}
