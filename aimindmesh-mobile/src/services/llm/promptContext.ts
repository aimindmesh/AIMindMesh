/**
 * Prompt context shared by every provider: the system prompt (persona, the profile of what is
 * known about the user, rules) and the context of the current user turn (related facts,
 * conversation memories, workspace documents). Remote providers put the turn context in the
 * system prompt; on-device engines prepend it to the user turn so their system prompt (and
 * KV cache) stays stable. Internal tasks (memory work, mesh tasks) get only their own system
 * text; background texts (proactive messages) carry their own retrieved context.
 */
import { LLMConfig, Message, Personality } from '../../types';
import { logger } from '../logger';
import { buildSystemPrompt } from './promptBuilder';
import { isBackgroundTask, isInternalTask } from './background/taskFlags';
import { estimateTokens, getProviderContextWindow } from './context/unifiedContextManager';
import { onDeviceContextSize } from './context/contextSize';
import { memoryThresholds } from '../memory/context/memoryThresholds';
import { cachedForTurn } from './context/turnContextCache';
import { evalHooks } from '../eval/evalHooks';
import { getActiveThreadId } from './threadManager';
import { factStore } from '../memory/facts/factStore';
import { Fact } from '../memory/facts/factTypes';
import { buildProfile, formatRelevantFacts, profileBudget, rankRelevantFacts, type ProfileStyle } from '../memory/context/memoryContext';
import { isRecallQuestion, RECALL_INSTRUCTION, recallFacts } from '../memory/context/recallQuestion';
import { buildOnDeviceSystemPrompt } from './prompt/onDevicePrompt';
import { resolveLanguage, type ResolvedLanguage } from './prompt/languageRule';
import { PROMPT_TEXTS } from './prompt/promptTexts';

export interface PromptContextOptions {
    personality: Personality;
    /** Optional only for providers that take it optionally (Claude, Perplexity) */
    llmConfig?: LLMConfig;
    history: Message[];
    responseHint?: string;
    /** Answer tokens of the turn (on-device: becomes a length rule in the assistant's language) */
    answerTokens?: number;
    /** On-device engines: compact prompt in the assistant's language (prompt/onDevicePrompt.ts) */
    onDevice?: boolean;
    /** Conversation the history belongs to (its memories already in the context are skipped) */
    threadId?: string | null;
}

export interface PromptContext {
    systemPrompt: string;
    /** Related facts, memories and workspace documents for the user turn ('' when none) */
    turnContext: string;
    /** Index in history of the user turn the context belongs to (-1: none) */
    turnIndex: number;
    /** Language of the answer (setting, else the user's messages) */
    language?: ResolvedLanguage;
}

/** Related facts and conversation memories of a turn, together */
const MEMORY_TOKEN_BUDGET = 400;
const RELATED_FACTS = 3;
/** "Do you remember…?": more facts and a looser search of past conversations */
const RECALL_FACTS = 10;
const RECALL_MEMORIES = 5;
/** The first turn after a cold start waits this long for the facts at most */
const FACTS_WAIT_MS = 1500;

/**
 * Last message the user really wrote: tool observations ('tool_*') and nudges ('nudge_*') of
 * the agentic loop are user-role messages too, but retrieving memories for them makes no sense.
 */
export function findUserTurnIndex(history: Message[]): number {
    for (let i = history.length - 1; i >= 0; i--) {
        const m = history[i];
        if (m.role === 'model') continue;
        if (m.id?.startsWith('tool_') || m.id?.startsWith('nudge_') || m.id?.startsWith('final_') || m.text?.startsWith('Observation:')) continue;
        return i;
    }
    return -1;
}

const ROLE_LABEL: Record<string, Record<string, string>> = {
    en: { user: 'the user said', system: 'summary', memory: 'related' },
    it: { user: "l'utente ha detto", system: 'riassunto', memory: 'collegato' },
};

/** Conversation memories as dated lines (the model needs to know how old a memory is) */
export function formatRelevantMemories(memories: Array<{ content: string; role: string; timestamp?: number }>, style?: ProfileStyle): string {
    if (memories.length === 0) return '';
    const labels = ROLE_LABEL[style?.lang ?? 'en'];
    const lines = memories.map(m => {
        const date = m.timestamp ? new Date(m.timestamp).toISOString().slice(0, 10) : '';
        const label = labels[m.role] || m.role;
        return `- [${date}${date ? ', ' : ''}${label}] ${m.content.replace(/^\[MEMORY SUMMARY\]\s*/, '')}`;
    });
    const header = style ? PROMPT_TEXTS[style.lang].pastHeader : 'FROM PAST CONVERSATIONS (may be outdated)';
    return `${header}:\n${lines.join('\n')}`;
}

function contextWindowOf(llmConfig: LLMConfig | undefined): number {
    if (!llmConfig) return 8192;
    return (llmConfig.provider && getProviderContextWindow(llmConfig.provider)) || onDeviceContextSize(llmConfig);
}

async function loadedFacts(): Promise<Fact[]> {
    if (!factStore.isReady()) {
        await Promise.race([factStore.ready.catch(() => undefined), new Promise(r => setTimeout(r, FACTS_WAIT_MS))]);
    }
    return factStore.isReady() ? factStore.active() : [];
}

/** Facts related to the query: by meaning when the embedding model is active, else by keywords */
async function relatedFacts(query: string, facts: Fact[], exclude: Set<string>, llmConfig: LLMConfig | undefined): Promise<Fact[]> {
    if (!query.trim() || facts.length === 0) return [];
    let vectors: { query: Float32Array; facts: Map<string, Float32Array>; minSimilarity: number } | undefined;
    if (llmConfig?.enableSemanticMemory && llmConfig.embeddingModelId) {
        try {
            const { ensureEmbeddingModel, embedText } = await import('../model/embedding/embeddingRuntime');
            if (await ensureEmbeddingModel(llmConfig.embeddingModelId)) {
                const { vector, key } = await embedText(query, 'query');
                const stored = await factStore.loadEmbeddings(key);
                vectors = { query: vector, facts: new Map(stored.map(s => [s.id, s.vector])), minSimilarity: memoryThresholds(llmConfig).related };
            }
        } catch (e) {
            logger.log('debug', '[PromptContext] Fact vectors unavailable, matching keywords', e);
        }
    }
    return rankRelevantFacts(query, facts, exclude, { limit: RELATED_FACTS, vectors });
}

type ConversationMemory = { content: string; role: string; timestamp?: number };

async function retrieveConversationMemories(query: string, llmConfig: LLMConfig | undefined, history: Message[], threadId?: string | null, recall = false): Promise<ConversationMemory[]> {
    if (evalHooks.memories) return evalHooks.memories; // on-device eval: the scenario's memories
    if (!llmConfig?.enableSemanticMemory || !llmConfig.embeddingModelId || !query.trim()) return [];
    try {
        const { getOrInitializeSemanticMemoryRetriever } = await import('../memory/semanticMemoryRetriever');
        const retriever = await getOrInitializeSemanticMemoryRetriever(llmConfig);
        if (!retriever) return [];
        // Messages of this conversation that the model receives anyway are not "memories"
        const since = history.reduce((min, m) => Math.min(min, new Date(m.timestamp).getTime() || Infinity), Infinity);
        const maxResults = llmConfig.semanticMemoryMaxResults || 3;
        const thresholds = memoryThresholds(llmConfig);
        const found = await retriever.retrieveRelevantMemories(
            query, undefined,
            recall ? Math.max(maxResults, RECALL_MEMORIES) : maxResults,
            recall ? thresholds.recall : thresholds.related,
            threadId && Number.isFinite(since) ? { sessionId: threadId, since } : undefined
        );
        if (found.length > 0) logger.log('info', `[PromptContext] ${found.length} conversation memories`);
        return found;
    } catch (e) {
        logger.log('warn', '[PromptContext] Memory retrieval failed', e);
        return [];
    }
}

async function retrieveWorkspaceContext(query: string): Promise<string> {
    if (evalHooks.noWorkspace) return '';
    if (!query.trim()) return '';
    try {
        const { contextInjector } = await import('./contextInjector');
        return (await contextInjector.buildSystemPromptWithContext(query, '')).trim();
    } catch (e) {
        logger.log('warn', '[PromptContext] Workspace context failed', e);
        return '';
    }
}

export async function buildPromptContext(options: PromptContextOptions): Promise<PromptContext> {
    const { personality, llmConfig, history } = options;
    if (isInternalTask(llmConfig)) {
        return { systemPrompt: personality.systemPrompt, turnContext: '', turnIndex: -1 };
    }
    // Within an agent run, every step of the same turn gets the same context
    const turn = history[findUserTurnIndex(history)];
    const key = [turn?.id, turn?.text, options.onDevice, options.answerTokens, options.threadId, personality.name,
        llmConfig?.provider, llmConfig?.assistantLanguage, isBackgroundTask(llmConfig)].join('|');
    return cachedForTurn(key, () => computePromptContext(options));
}

async function computePromptContext(options: PromptContextOptions): Promise<PromptContext> {
    const { personality, llmConfig, history } = options;

    // The profile is always part of the prompt (with or without semantic memory)
    const facts = await loadedFacts();
    const language = resolveLanguage(llmConfig?.assistantLanguage, recentUserTexts(history), deviceLocale());
    const style: ProfileStyle | undefined = options.onDevice ? { lang: language } : undefined;
    const profile = buildProfile(facts, profileBudget(contextWindowOf(llmConfig)), Date.now(), style);
    const systemPrompt = options.onDevice
        ? buildOnDeviceSystemPrompt(personality, profile.text || undefined, language, { answerTokens: options.answerTokens })
        : buildSystemPrompt(personality, profile.text || undefined, options.responseHint);
    // Background texts (proactive messages, briefings) carry their own retrieved context
    if (isBackgroundTask(llmConfig)) return { systemPrompt, turnContext: '', turnIndex: -1, language };

    const turnIndex = findUserTurnIndex(history);
    const query = turnIndex >= 0 ? history[turnIndex].text || '' : '';
    const recall = isRecallQuestion(query);
    const inProfile = new Set(profile.factIds);
    const [ranked, memories, workspace] = await Promise.all([
        relatedFacts(query, facts, inProfile, llmConfig),
        retrieveConversationMemories(query, llmConfig, history, options.threadId ?? getActiveThreadId(), recall),
        retrieveWorkspaceContext(query),
    ]);
    const related = recall ? recallFacts(ranked, facts, inProfile, RECALL_FACTS) : ranked;
    if (related.length > 0) void factStore.touch(related.map(f => f.id));
    if (recall) logger.log('info', `[PromptContext] Recall question: ${related.length} extra facts, memories ${memories ? 'found' : 'none'}`);
    const recallInstruction = recall ? (style ? PROMPT_TEXTS[language].recall : RECALL_INSTRUCTION) : '';
    // One memory block: related facts first, conversation memories in what is left of the budget
    const factsBlock = formatRelevantFacts(related, style);
    const memoriesBlock = formatRelevantMemories(fitMemories(memories, MEMORY_TOKEN_BUDGET - estimateTokens(factsBlock)), style);
    const turnContext = [factsBlock, memoriesBlock, workspace, recallInstruction]
        .filter(Boolean).join('\n\n');
    return { systemPrompt, turnContext, turnIndex, language };
}

/** Memories in order of relevance while they fit the token budget (the last one cut to fit) */
function fitMemories(memories: ConversationMemory[], budget: number): ConversationMemory[] {
    const kept: ConversationMemory[] = [];
    let left = budget;
    for (const memory of memories) {
        const cost = estimateTokens(memory.content) + 12; // date and label
        if (cost <= left) {
            kept.push(memory);
            left -= cost;
        } else {
            if (left > 40) kept.push({ ...memory, content: `${memory.content.slice(0, Math.floor((left - 12) * 3))}…` });
            break;
        }
    }
    return kept;
}

/** The user's latest messages, newest first (for the reply language) */
function recentUserTexts(history: Message[]): string[] {
    const texts: string[] = [];
    for (let i = history.length - 1; i >= 0 && texts.length < 3; i--) {
        const m = history[i];
        if (m.role === 'user' && !m.hidden && !m.id?.startsWith('tool_') && !m.id?.startsWith('final_') && m.text) texts.push(m.text);
    }
    return texts;
}

function deviceLocale(): string | undefined {
    return typeof navigator !== 'undefined' ? navigator.language : undefined;
}

const CONTEXT_INTRO: Record<ResolvedLanguage, string> = {
    en: 'Use this context about the user and their documents when it is relevant to the request:',
    it: "Usa questo contesto sull'utente e sui suoi documenti quando serve alla richiesta:",
};

/** System prompt with the turn context appended (remote providers). */
export function systemPromptWithContext(context: PromptContext): string {
    return context.turnContext ? `${context.systemPrompt}\n\n${context.turnContext}` : context.systemPrompt;
}

/** History with the turn context prepended to the user turn (on-device engines). */
export function historyWithTurnContext(history: Message[], context: PromptContext): Message[] {
    if (!context.turnContext || context.turnIndex < 0 || context.turnIndex >= history.length) return history;
    const updated = [...history];
    const turn = updated[context.turnIndex];
    updated[context.turnIndex] = {
        ...turn,
        text: `<context>\n${CONTEXT_INTRO[context.language ?? 'en']}\n${context.turnContext}\n</context>\n\n${turn.text}`,
    };
    return updated;
}
