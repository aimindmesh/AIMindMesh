/**
 * Runtime-only marks on a copy of LLMConfig. They are symbol keys: object spread keeps them
 * (every provider copies the config), JSON.stringify drops them, so they can never end up in
 * the persisted 'llm-config'.
 *
 * - internal: a task of the app itself (memory extraction, summaries, mesh tasks). Providers
 *   send only the task's own system text: no persona, no memories, no workspace documents,
 *   no inline <save_memory> rule, no web search.
 * - background: generation scheduled by llmArbiter. It never waits for nor interrupts the
 *   chat (the chat interrupts it) and is not counted as chat activity.
 * - routed tools: the tools the on-device router offers for this turn (toolRouter).
 * - grammar: a GBNF the answer must follow (memory extraction), for the engines that sample
 *   with a grammar (GenieX llama_cpp runtime); the others ignore it.
 */
const INTERNAL = Symbol('aimindmesh.internalTask');
const BACKGROUND = Symbol('aimindmesh.backgroundTask');
const GRAMMAR = Symbol('aimindmesh.taskGrammar');
const ROUTED = Symbol('aimindmesh.routedTools');

type Marked = { [INTERNAL]?: boolean; [BACKGROUND]?: boolean; [GRAMMAR]?: string; [ROUTED]?: string[] };

export function asInternalTask<T extends object>(config: T): T {
    return { ...config, [INTERNAL]: true };
}

export function asBackgroundTask<T extends object>(config: T): T {
    return { ...config, [BACKGROUND]: true };
}

export function isInternalTask(config: object | null | undefined): boolean {
    return !!(config as Marked | null | undefined)?.[INTERNAL];
}

export function isBackgroundTask(config: object | null | undefined): boolean {
    return !!(config as Marked | null | undefined)?.[BACKGROUND];
}

export function withGrammar<T extends object>(config: T, grammar: string | undefined): T {
    return grammar ? { ...config, [GRAMMAR]: grammar } : config;
}

export function taskGrammar(config: object | null | undefined): string | undefined {
    return (config as Marked | null | undefined)?.[GRAMMAR];
}

export function withRoutedTools<T extends object>(config: T, tools: string[]): T {
    return { ...config, [ROUTED]: tools };
}

/** Tools the router chose for this turn, or undefined when there was no routing (remote models) */
export function routedTools(config: object | null | undefined): string[] | undefined {
    return (config as Marked | null | undefined)?.[ROUTED];
}
