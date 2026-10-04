/**
 * When the memory is consolidated: never while the user chats. A conversation is read once
 * the chat has been quiet for 3 minutes (the user's choice for on-device models, used for
 * every provider so a whole exchange is read at once), and again at the proactive checks
 * for anything left behind. A cursor per conversation remembers the last message read.
 */
import { LLMConfig, Message } from '../../../types';
import { logger } from '../../logger';
import { runBackgroundTask, ON_DEVICE_IDLE_MS } from '../../llm/background/backgroundLlm';
import { isChatIdleFor } from '../../llm/background/chatActivity';
import { isOnDeviceProvider, readStoredLlmConfig, readStoredServerSettings, resolveEffectiveProvider } from '../../llm/providerKeys';
import { getActiveThreadId } from '../../llm/threadManager';
import { factStore } from './factStore';
import { resolveLanguage, type ResolvedLanguage } from '../../llm/prompt/languageRule';
import { recordEpisode } from '../episodes/episodeSummary';
import {
    CONSOLIDATION_SYSTEM_PROMPTS, FACT_OPS_GRAMMAR, applyOps, batchMessages, buildConsolidationPrompt, expireOpenLoops,
    knownFactsFor, messagesAfterCursor, parseOps, validateOps,
} from './factConsolidator';

const CURSOR_PREFIX = 'consolidation-cursor:';
const QUIET_MS = ON_DEVICE_IDLE_MS;
const MAX_PENDING_THREADS = 5;
/** Characters of conversation per request: small context windows get smaller batches */
const BATCH_CHARS_ON_DEVICE = 2500;
const BATCH_CHARS_REMOTE = 6000;
/** A batch with no user message this long has nothing to remember */
const MIN_USER_TEXT = 12;

type Outcome = 'done' | 'retry';

function readJson<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) as T : fallback;
    } catch {
        return fallback;
    }
}

/** User categories offered to the model when "AI Auto-Categorization" is on */
function categoriesForModel(): string[] | undefined {
    if (!readJson<boolean>('enable-ai-memory-categorization', false)) return undefined;
    const categories = readJson<string[]>('memory-categories', []);
    return Array.isArray(categories) && categories.length > 0 ? categories : undefined;
}

/** Language of what memory work writes: the setting, else the user's messages, else the device */
function languageOf(config: LLMConfig | null, messages: Message[]): ResolvedLanguage {
    const texts = messages.filter(m => m.role === 'user').map(m => m.text).reverse();
    return resolveLanguage(config?.assistantLanguage, texts, typeof navigator !== 'undefined' ? navigator.language : undefined);
}

export class ConsolidationScheduler {
    private pending = new Map<string, Message[]>();
    private timer: ReturnType<typeof setTimeout> | null = null;
    private running = false;

    /** A reply completed in `threadId`: its messages are read once the chat is quiet. */
    note(threadId: string | null | undefined, messages: Message[]): void {
        if (!threadId || messages.length === 0) return;
        this.pending.delete(threadId);
        this.pending.set(threadId, messages);
        while (this.pending.size > MAX_PENDING_THREADS) this.pending.delete(this.pending.keys().next().value!);
        this.arm();
    }

    hasPending(): boolean {
        return this.pending.size > 0;
    }

    private arm(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => { this.timer = null; void this.run('quiet chat'); }, QUIET_MS + 1000);
    }

    /** Reads every pending conversation if the chat is quiet (else waits for the next chance). */
    async run(reason: string): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            await factStore.ready;
            await expireOpenLoops();
            if (this.pending.size === 0) this.pickUpActiveConversation();
            if (this.pending.size === 0) return;
            if (!isChatIdleFor(QUIET_MS)) {
                this.arm();
                return;
            }
            logger.log('info', `[Consolidation] Reading ${this.pending.size} conversation(s) (${reason})`);
            for (const [threadId, messages] of [...this.pending]) {
                if (await this.consolidate(threadId, messages) === 'retry') break;
                this.pending.delete(threadId);
            }
        } catch (e) {
            logger.log('warn', '[Consolidation] Run failed', e);
        } finally {
            this.running = false;
        }
    }

    /** After a restart nothing is pending: the active conversation may have unread messages */
    private pickUpActiveConversation(): void {
        const threadId = getActiveThreadId();
        const messages = readJson<Message[]>('chat-history', []);
        if (threadId && Array.isArray(messages) && messages.length > 0) this.pending.set(threadId, messages);
    }

    private async consolidate(threadId: string, messages: Message[]): Promise<Outcome> {
        const cursorKey = CURSOR_PREFIX + threadId;
        const fresh = messagesAfterCursor(messages, await factStore.getMeta(cursorKey));
        if (fresh.length === 0) return 'done';

        const config = readStoredLlmConfig();
        const provider = config ? resolveEffectiveProvider(config, readStoredServerSettings()) : '';
        const maxChars = isOnDeviceProvider(provider) ? BATCH_CHARS_ON_DEVICE : BATCH_CHARS_REMOTE;
        const categories = categoriesForModel();

        for (const batch of batchMessages(fresh, maxChars)) {
            const last = batch[batch.length - 1];
            if (!batch.some(m => m.role === 'user' && m.text.trim().length >= MIN_USER_TEXT)) {
                await factStore.setMeta(cursorKey, last.id);
                continue;
            }
            const known = knownFactsFor(batch, factStore.active());
            // In the assistant's language: facts are written as the user will read them
            const lang = languageOf(config, batch);
            const result = await runBackgroundTask({
                label: 'memory-consolidation',
                prompt: buildConsolidationPrompt({ batch, known, now: Date.now(), maxChars, categories, lang }),
                systemPrompt: CONSOLIDATION_SYSTEM_PROMPTS[lang],
                maxTokens: 600,
                grammar: FACT_OPS_GRAMMAR,
            });
            if (!result.text && result.skipped !== 'empty') {
                logger.log('info', `[Consolidation] Postponed: ${result.skipped}`);
                return 'retry'; // model busy, chat active, no key...: the cursor stays
            }
            const ops = result.text ? validateOps(parseOps(result.text), known, categories, { batch, active: factStore.active() }) : [];
            const applied = await applyOps(ops, threadId);
            await factStore.setMeta(cursorKey, last.id);
            logger.log('info', `[Consolidation] ${batch.length} messages: +${applied.added} new, ${applied.updated} updated, ${applied.done} done, ${applied.skipped} skipped`);
        }
        // Then the episodic memory: a summary of the stretch, not the raw messages
        return recordEpisode(threadId, messages, languageOf(config, messages), config);
    }

    /** Test hook */
    reset(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.pending.clear();
        this.running = false;
    }
}

export const consolidationScheduler = new ConsolidationScheduler();
