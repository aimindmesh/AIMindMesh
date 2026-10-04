/** Chat-format family of an on-device model, from its file or bundle name */
export type ModelFamily = 'gemma4' | 'qwen3' | 'generic';

export function modelFamily(modelPath: string | undefined | null): ModelFamily {
    const name = (modelPath ?? '').split('/').pop()?.toLowerCase() ?? '';
    if (/gemma[-_ ]?4/.test(name)) return 'gemma4';
    if (/qwen[-_ ]?3/.test(name)) return 'qwen3';
    return 'generic';
}
