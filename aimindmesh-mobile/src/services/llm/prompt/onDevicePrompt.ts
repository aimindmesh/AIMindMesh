/**
 * Compact system prompt of the on-device engines (Genie, GGUF, LiteRT), in the assistant's
 * language. The companion prompt for remote models (promptBuilder.buildSystemPrompt) is long,
 * English and full of conflicting rules ("caring friend" vs a professional persona): on a 2–4B
 * model with a 2048 context it was truncated and made answers drift to English.
 */
import type { Personality } from '../../../types';
import { LANGUAGE_RULE, type ResolvedLanguage } from './languageRule';
import { lengthHint, PROMPT_TEXTS, todayLine } from './promptTexts';

export interface OnDevicePromptOptions {
    now?: Date;
    /** Answer tokens of the turn (turnBudget): a short limit becomes a short-answer rule */
    answerTokens?: number;
}

export function buildOnDeviceSystemPrompt(personality: Personality, profile: string | undefined, lang: ResolvedLanguage, options: OnDevicePromptOptions = {}): string {
    const t = PROMPT_TEXTS[lang];
    const rules = [...t.rules, lengthHint(lang, options.answerTokens)].filter(Boolean);
    const persona = [t.you(personality.name), personality.systemPrompt?.trim()].filter(Boolean).join(' ');
    const traits = personality.traits?.length ? `${t.traits}: ${personality.traits.join(', ')}.` : '';
    return [
        [persona, traits].filter(Boolean).join('\n'),
        profile?.trim() || '',
        rules.map(r => `- ${r}`).join('\n'),
        todayLine(lang, options.now ?? new Date()),
    ].filter(Boolean).join('\n\n');
}

/** The language rule closes the system prompt (after the tool instructions, when there are any) */
export function withLanguageRule(systemPrompt: string, lang: ResolvedLanguage): string {
    return `${systemPrompt.trimEnd()}\n\n${LANGUAGE_RULE[lang]}`;
}
