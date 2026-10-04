/** Limits of an agent run: on-device models loop on tools (Fold7: 5 tools for one question) */
import type { ToolCall } from '../../hooks/chat/types';

/** Tool steps before the answer is forced: small on-device models get 3, remote ones the setting */
export function maxToolSteps(onDevice: boolean, configured: number | undefined): number {
    const setting = configured && configured > 0 ? configured : 5;
    return onDevice ? Math.min(3, setting) : setting;
}

/** Same tool with the same arguments: running it again gives the model nothing new */
export function callSignature(call: Pick<ToolCall, 'name' | 'args'>): string {
    const sorted = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(sorted);
        if (value && typeof value === 'object') {
            return Object.fromEntries(Object.keys(value as object).sort().map(k => [k, sorted((value as Record<string, unknown>)[k])]));
        }
        return typeof value === 'string' ? value.trim().toLowerCase() : value;
    };
    return `${call.name}:${JSON.stringify(sorted(call.args ?? {}))}`;
}

/**
 * A tool the model's reasoning says it will use ("I should use the `add_shopping_item` tool"),
 * among the tools offered this turn; undefined when it names none.
 */
export function plannedTool(thinking: string, offered: string[] | undefined): string | undefined {
    if (!thinking || !offered?.length) return undefined;
    // "no need for search_web" is not a plan
    if (/\b(no need|not need|don't need|do not need|without (a |any )?tool|non serve|non ho bisogno|senza strument)/i.test(thinking)) return undefined;
    if (!/\b(use|call|using|calling|invoke|usare|uso|userò|chiamare|chiamo|chiamerò|utilizz)/i.test(thinking)) return undefined;
    return offered.find(name => new RegExp(`(^|[^\\w])${name}([^\\w]|$)`).test(thinking));
}
