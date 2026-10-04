/**
 * How the loaded model's chat template handles tools (checked once per model): 'template' it
 * renders them (GGUF templates of Gemma 4 and Qwen 3); 'ignored' it drops them (the app falls
 * back to the ReAct prompt, or the model would have no tools at all); 'none' there is no
 * template (QAIRT bundles without one: Gemma 4 is then formatted by the app).
 */
export type ToolTemplateSupport = 'template' | 'ignored' | 'none';
import { Genie } from 'genie-capacitor';
import { logger } from '../../logger';

const PROBE = 'aimm_probe_tool';
const checked = new Map<string, ToolTemplateSupport>();

export async function toolTemplateSupport(modelPath: string): Promise<ToolTemplateSupport> {
    const known = checked.get(modelPath);
    if (known !== undefined) return known;
    let support: ToolTemplateSupport = 'none';
    try {
        const tools = JSON.stringify([{ type: 'function', function: { name: PROBE, description: 'probe', parameters: { type: 'object', properties: {}, required: [] } } }]);
        const { prompt } = await Genie.formatChat({ messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }], tools });
        support = prompt.includes(PROBE) ? 'template' : 'ignored';
    } catch (e) {
        logger.log('info', '[NativeTools] No chat template for this model', e);
    }
    logger.log('info', `[NativeTools] ${modelPath.split('/').pop()}: tools ${support}`);
    checked.set(modelPath, support);
    return support;
}

export function resetNativeToolSupportForTests(): void {
    checked.clear();
}
