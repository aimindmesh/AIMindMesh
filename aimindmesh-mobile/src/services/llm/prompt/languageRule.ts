/**
 * The language the assistant answers and writes memories in. Small on-device models drift to
 * English with English instructions; a short rule in the target language, at the end of the
 * system prompt, keeps them on it.
 */

export type AssistantLanguage = 'auto' | 'it' | 'en';
export type ResolvedLanguage = 'it' | 'en';

// Words that exist in both languages ("a", "i", "in", "me", "come") are in neither list
const IT_WORDS = new Set(('il lo la gli le un una di da con su per tra fra che non è sono sei hai ho ha abbiamo del della dei delle '
    + 'degli al alla alle agli nel nella sul sulla ma cosa quando dove perché anche più molto ti mi si ci se o e questo questa quello '
    + 'quella sì grazie ciao puoi posso vuoi sempre già ancora mio mia tuo tua fa domani oggi ieri stai sto bene tutto qui poi ora '
    + 'adesso dimmi ricordi sai fare voglio vorrei').split(' '));
const EN_WORDS = new Set(('the an of to on with for at by from that this is are was were be been have has had do does did not and or '
    + 'but if you your my we it its as can will would should could there what when where why how which about tell please hello '
    + 'thanks yes').split(' '));

/** 'it' | 'en' from function words, or null when the text is too short or neither */
export function detectLanguage(text: string): ResolvedLanguage | null {
    const words = text.toLowerCase().match(/\p{L}+/gu) || [];
    if (words.length < 3) return null;
    let it = 0, en = 0;
    for (const w of words) {
        if (IT_WORDS.has(w)) it++;
        if (EN_WORDS.has(w)) en++;
    }
    if (it === en) return null;
    return it > en ? 'it' : 'en';
}

/**
 * The language to use now: the setting, or for `auto` the language of the user's latest
 * messages (newest first), else the device locale, else Italian.
 */
export function resolveLanguage(setting: AssistantLanguage | undefined, recentUserTexts: string[], deviceLocale?: string): ResolvedLanguage {
    if (setting === 'it' || setting === 'en') return setting;
    for (const text of recentUserTexts) {
        const lang = detectLanguage(text);
        if (lang) return lang;
    }
    const joined = detectLanguage(recentUserTexts.join(' '));
    if (joined) return joined;
    if (deviceLocale?.toLowerCase().startsWith('en')) return 'en';
    return 'it';
}

/** "Scrivi", not "Rispondi": rules about answering made Gemma 4 E2B answer instead of calling a tool */
export const LANGUAGE_RULE: Record<ResolvedLanguage, string> = {
    it: 'Scrivi sempre e solo in italiano, anche se le istruzioni sono in inglese.',
    en: 'Always write in English.',
};
