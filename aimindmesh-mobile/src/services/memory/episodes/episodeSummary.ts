/**
 * Episodic memory: one short summary per stretch of conversation instead of every raw message
 * (questions and small talk crowded the memory search out). Written by the consolidation when
 * the chat is quiet, as an internal task, in the assistant's language; read back by the memory
 * search as "summary" rows (role 'system', SUMMARY_PREFIX).
 */
import type { LLMConfig, Message } from '../../../types';
import type { ResolvedLanguage } from '../../llm/prompt/languageRule';
import { logger } from '../../logger';
import { runBackgroundTask } from '../../llm/background/backgroundLlm';
import { factStore } from '../facts/factStore';
import { messagesAfterCursor } from '../facts/factConsolidator';
import { SUMMARY_PREFIX } from '../episodicMaintenance';

const CURSOR_PREFIX = 'episode-cursor:';
/** A stretch worth a summary: at least this many user messages with some content */
const MIN_USER_MESSAGES = 2;
const MIN_USER_CHARS = 60;
const MAX_CHARS = 3000;
const NOTHING = /^\W*(niente|nothing)\W*$/i;

const TEXTS: Record<ResolvedLanguage, { system: string; ask: string; user: string; assistant: string }> = {
    it: {
        system: "Riassumi conversazioni per la memoria di un assistente personale.",
        ask: "Scrivi in una o due frasi, in italiano, cosa ha raccontato, chiesto o deciso l'utente, in terza persona (\"L'utente…\"), con i nomi, i luoghi e le date che ha detto. Niente saluti né commenti. Se non c'è niente che valga la pena ricordare, scrivi solo: NIENTE",
        user: 'Utente',
        assistant: 'Assistente',
    },
    en: {
        system: "You summarize conversations for a personal assistant's memory.",
        ask: 'Write in one or two sentences, in English, what the user told, asked or decided, in the third person ("The user…"), with the names, places and dates they gave. No greetings or comments. If nothing is worth remembering, write only: NOTHING',
        user: 'User',
        assistant: 'Assistant',
    },
};

export function buildEpisodePrompt(batch: Message[], lang: ResolvedLanguage): string {
    const t = TEXTS[lang];
    let size = 0;
    const lines: string[] = [];
    for (const m of batch) {
        const line = `${m.role === 'user' ? t.user : t.assistant}: ${m.text.replace(/\s+/g, ' ').trim()}`;
        if (size + line.length > MAX_CHARS) break;
        lines.push(line);
        size += line.length;
    }
    return `${lines.join('\n')}\n\n${t.ask}`;
}

/** The summary to store, or null when the model found nothing worth remembering */
export function episodeText(answer: string | null): string | null {
    const text = (answer ?? '').replace(/\s+/g, ' ').trim();
    if (text.length < 20 || NOTHING.test(text)) return null;
    return text.slice(0, 600);
}

/**
 * Summarizes the messages of a conversation not summarized yet. 'retry' when the model could
 * not run now (the cursor stays); short stretches wait for more messages.
 */
export async function recordEpisode(threadId: string, messages: Message[], lang: ResolvedLanguage, config: LLMConfig | null): Promise<'done' | 'retry'> {
    if (!config?.enableSemanticMemory || !config.embeddingModelId) return 'done';
    const cursorKey = CURSOR_PREFIX + threadId;
    const fresh = messagesAfterCursor(messages, await factStore.getMeta(cursorKey));
    const userTexts = fresh.filter(m => m.role === 'user').map(m => m.text.trim());
    if (userTexts.length < MIN_USER_MESSAGES || userTexts.join(' ').length < MIN_USER_CHARS) return 'done';

    const result = await runBackgroundTask({
        label: 'episode-summary',
        prompt: buildEpisodePrompt(fresh, lang),
        systemPrompt: TEXTS[lang].system,
        maxTokens: 160,
    });
    if (!result.text && result.skipped !== 'empty') return 'retry';
    const summary = episodeText(result.text);
    if (summary) {
        const { getOrInitializeSemanticMemoryRetriever } = await import('../semanticMemoryRetriever');
        const retriever = await getOrInitializeSemanticMemoryRetriever(config);
        if (!retriever) return 'retry';
        await retriever.saveMessage(threadId, 'system', `${SUMMARY_PREFIX} ${summary}`);
        logger.log('info', `[Episodes] Summary of ${fresh.length} messages saved`);
    }
    await factStore.setMeta(cursorKey, fresh[fresh.length - 1].id);
    return 'done';
}
