/**
 * Whether the GGUF chat template of the llama.cpp engine renders tools (checked once per
 * model): Gemma 4 and Qwen 3 templates do; otherwise the ReAct prompt is used.
 */
import { registerPlugin } from '@capacitor/core';
import { logger } from '../../../logger';

const LlamaCpp = registerPlugin('LlamaCpp') as any;
const PROBE = 'aimm_probe_tool';
const checked = new Map<string, boolean>();

export async function ggufTemplateRendersTools(contextId: number, modelPath: string): Promise<boolean> {
    const known = checked.get(modelPath);
    if (known !== undefined) return known;
    let ok = false;
    try {
        const tools = JSON.stringify([{ type: 'function', function: { name: PROBE, description: 'probe', parameters: { type: 'object', properties: {}, required: [] } } }]);
        const messages = JSON.stringify([{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }]);
        const result = await LlamaCpp.getFormattedChat({ contextId, messages, chatTemplate: '', tools, enableThinking: false });
        ok = typeof result?.prompt === 'string' && result.prompt.includes(PROBE);
    } catch (e) {
        logger.log('info', '[GGUF] Chat template without tools', e);
    }
    logger.log('info', `[GGUF] ${modelPath.split('/').pop()}: ${ok ? 'native tool format' : 'ReAct prompt'}`);
    checked.set(modelPath, ok);
    return ok;
}
