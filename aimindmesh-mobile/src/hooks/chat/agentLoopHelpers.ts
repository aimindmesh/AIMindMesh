/**
 * Pure helpers of the agentic loop (useAgenticLoop): provider/key selection, history entries
 * for tool turns, and the text shown while streaming and at the end.
 */
import { Message, LLMConfig, AIMindMeshServerSettings } from '../../types';
import { ApiKeys, ToolCall, ToolRunResult } from './types';
import { getResponseReserve } from '../../services/llm/context/unifiedContextManager';
import { isOnDeviceProvider, resolveEffectiveProvider } from '../../services/llm/providerKeys';
import { INLINE_MEMORY_PLACEHOLDER } from '../../services/llm/promptBuilder';
import { onDeviceContextSize } from '../../services/llm/context/contextSize';

/** Provider that actually answers: the server's fallback when the server is the provider. */
export function effectiveProvider(llmConfig: LLMConfig, serverSettings?: AIMindMeshServerSettings): string {
    return resolveEffectiveProvider(llmConfig, serverSettings);
}

/** API key of that provider only: a key is never sent to another vendor's API. */
export function apiKeyForProvider(provider: string, apiKeys: ApiKeys, llmConfig: LLMConfig): string | undefined {
    switch (provider) {
        case 'gemini': return apiKeys.gemini;
        case 'perplexity': return apiKeys.perplexity;
        case 'claude': return apiKeys.claude;
        case 'openrouter': return llmConfig.openrouterApiKey;
        default: return undefined; // On-device and local-server providers need no key
    }
}

/**
 * Token budget for compressing the history before a step, or Infinity when the provider
 * prunes against its own (large) window. On-device models keep the old 1500 floor.
 */
export function compressionBudget(provider: string, llmConfig: LLMConfig, maxResponseTokens: number): number {
    // On-device engines: small context windows, history compressed before each step
    if (!isOnDeviceProvider(provider)) return Infinity;
    const contextSize = onDeviceContextSize(llmConfig);
    // ~1000 tokens for the system prompt and tool instructions
    return Math.max(1500, contextSize - getResponseReserve(contextSize, maxResponseTokens) - 1000);
}

const ANSWER_PREFIX = /(?:^|\n)(?:Final )?Answer:\s*/i;
const TOOL_TAGS = /<tool>[\s\S]*?(?:<\/tool>|$)/g;
const BRACKET_TOOL_TAGS = /\[tool\][\s\S]*?(?:\[\/tool\]|$)/g;
const THINKING_TAGS = /<thinking>[\s\S]*?(?:<\/thinking>|$)/g;
const MEMORY_TAGS = /<save_memory>[\s\S]*?(?:<\/save_memory>|$)/gi;

/** Text shown in the bubble while streaming: the answer part only, plus an optional status line. */
export function streamDisplayText(text: string, status?: string): string {
    let cleanText = text ? text.replace(/^\s+/, '') : '';
    const answerMatch = cleanText.match(ANSWER_PREFIX);
    if (answerMatch && answerMatch.index !== undefined) {
        // We found an Answer: block, only show what comes after it
        cleanText = cleanText.substring(answerMatch.index + answerMatch[0].length);
    } else if (cleanText.includes('<tool>') || cleanText.includes('</tool>')) {
        // If it's a tool block without Answer:, don't show the tool call JSON to the user
        cleanText = '';
    }
    // Clean inline memory tags so they don't show on screen
    cleanText = cleanText.replace(MEMORY_TAGS, '');
    return status ? (cleanText ? `${cleanText}\n\n_${status}_` : `_${status}_`) : cleanText;
}

/**
 * Model turn recorded in history for a tool batch: reasoning, any answer text, then the calls
 * in canonical form (raw tags are stripped so they are not duplicated).
 */
export function buildToolTurnText(response: string, thinking: string, calls: ToolCall[]): string {
    let cleanBody = response
        .replace(THINKING_TAGS, '')
        .replace(TOOL_TAGS, '')
        .replace(BRACKET_TOOL_TAGS, '')
        .trim();
    const answerMatch = cleanBody.match(ANSWER_PREFIX);
    if (answerMatch && answerMatch.index !== undefined) {
        cleanBody = cleanBody.substring(answerMatch.index + answerMatch[0].length);
    } else if (response.includes('<tool>') || response.includes('</tool>')) {
        // Text before a tool call without "Answer:" is narration ("I will now search..."): kept in
        // history it reads as a final reply and the model repeats it
        cleanBody = '';
    }

    let turn = thinking ? `<thinking>${thinking}</thinking>\n` : '';
    if (cleanBody) turn += `${cleanBody}\n`;
    turn += calls.map(call => `<tool>${call.name}(${JSON.stringify(call.args)})</tool>`).join('\n');
    return turn.trim();
}

/** Observation turn with the results of one tool batch (never earlier batches). */
export function buildObservationMessage(results: ToolRunResult[], id: string): Message {
    const lines = results.map(r => `[${r.name}]: ${r.success ? r.result : `Failed - ${r.result}`}`);
    return { id, role: 'user', text: `Observation:\n${lines.join('\n\n')}`, timestamp: new Date() };
}

/**
 * Thinking streamed as plain text (<thinking> inside the response) added to the thinking shown
 * in the bubble, so it does not disappear when the tool runs.
 */
export function mergeTextThinking(thinking: string, response: string): string {
    const match = response.match(/<thinking>([\s\S]*?)(?:<\/thinking>|$)/);
    if (!match) return thinking;
    const extracted = match[1]
        .replace(/<\/?thinking>/g, '')
        .replace(TOOL_TAGS, '')
        .replace(BRACKET_TOOL_TAGS, '')
        .trim();
    if (!extracted || thinking.includes(extracted)) return thinking;
    return (thinking + '\n' + extracted).trim();
}

/** Contents of inline <save_memory> tags (closed or cut at the end of the text). */
export function extractInlineMemories(text: string): string[] {
    const matches = text.match(/<save_memory>([\s\S]*?)(?:<\/save_memory>|$)/ig) || [];
    return matches
        .map(m => m.replace(/<\/?save_memory>/ig, '').trim())
        // A small model may copy the format placeholder of the prompt instead of a fact
        .filter(m => m && m.toLowerCase() !== INLINE_MEMORY_PLACEHOLDER);
}

/** Final answer: tags, status lines and the "Answer:" prefix removed. */
export function cleanFinalAnswer(finalResponse: string): string {
    let clean = finalResponse
        .replace(/_🔄 Reasoning step \d+ of \d+\.\.._/g, '')
        .replace(THINKING_TAGS, '')
        .replace(TOOL_TAGS, '')
        .replace(BRACKET_TOOL_TAGS, '')
        .replace(MEMORY_TAGS, '')
        .trim();
    const answerMatch = clean.match(ANSWER_PREFIX);
    if (answerMatch && answerMatch.index !== undefined) {
        clean = clean.substring(answerMatch.index + answerMatch[0].length);
    } else if (finalResponse.includes('<tool>') || finalResponse.includes('</tool>')) {
        // A tool call without "Answer:": the text around it is reasoning, not the answer
        clean = '';
    }
    return clean;
}

/**
 * Whether the model produced only a very short thought (no answer, no tool): it is asked to
 * continue. Long thinking usually contains the answer and is shown as such.
 */
export function shouldNudgeModel(response: string, thinking: string, iteration: number, maxIterations: number): boolean {
    const cleanResponse = response.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
    const hasSubstantiveResponse = cleanResponse.length > 0 && cleanResponse !== '<'; // Reject lone '<'
    const lower = thinking.toLowerCase();
    const thinkingHasAnswer = ['the image', 'the picture', 'the audio', 'i see', 'this shows'].some(k => lower.includes(k));
    return !hasSubstantiveResponse &&
        !thinkingHasAnswer &&
        thinking.length > 5 &&
        thinking.length < 80 &&
        iteration < maxIterations - 1;
}

type Source = { title: string; uri: string };
/** Sources shown under one answer at most */
const MAX_SOURCES = 10;

/** Sources of the answer: earlier ones first, each URL once. */
export function mergeSources(current: Source[], incoming?: Source[]): Source[] {
    if (!incoming || incoming.length === 0) return current;
    const merged = [...current];
    for (const source of incoming) {
        if (merged.length >= MAX_SOURCES) break;
        if (source?.uri && !merged.some(s => s.uri === source.uri)) merged.push({ title: source.title || source.uri, uri: source.uri });
    }
    return merged;
}

/** The request this run answers: the last user message that is not a tool observation or a nudge. */
export function findUserRequest(history: Message[]): string {
    for (let i = history.length - 1; i >= 0; i--) {
        const message = history[i];
        if (message.role !== 'user' || message.id.startsWith('tool_') || message.id.startsWith('nudge_')) continue;
        return message.text.trim();
    }
    return '';
}

/** Prompt that shrinks a long tool output to what the user's request needs. */
export function buildToolSummaryPrompt(output: string, request: string): string {
    const focus = request
        ? `The user asked: "${request.slice(0, 500)}"\nKeep only the facts, figures, dates and URLs needed to answer that request.`
        : 'Keep only the facts relevant to answer a user request.';
    return `Summarize this tool output. ${focus} Do not add information.\n\nOutput:\n${output.substring(0, 15000)}`;
}
