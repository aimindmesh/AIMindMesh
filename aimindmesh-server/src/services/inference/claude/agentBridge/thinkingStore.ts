/**
 * Thinking blocks of the agents' tool-calling turns. The OpenAI format the agents speak cannot
 * carry them, so the server keeps them, keyed by the id of the tool call they preceded, and puts
 * them back when the agent sends that assistant turn again: the model keeps its reasoning across
 * the tool loop and the cached prefix stays identical. Requests also ask the API to drop, rather
 * than reject, a block that no longer matches (an agent that compacted its history).
 */
const TTL_MS = 2 * 3_600_000;
const MAX_ENTRIES = 2_000;

interface Entry {
  blocks: unknown[];
  at: number;
}

const store = new Map<string, Entry>();

function prune(now: number): void {
  for (const [id, entry] of store) {
    if (now - entry.at > TTL_MS) store.delete(id);
  }
  while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value as string);
}

/** Remembers the thinking blocks of an assistant turn under each of its tool call ids. */
export function rememberThinking(content: Array<{ type: string; id?: string }>): void {
  const thinking = content.filter(b => b.type === 'thinking' || b.type === 'redacted_thinking');
  if (thinking.length === 0) return;
  const now = Date.now();
  for (const block of content) {
    if (block.type === 'tool_use' && block.id) store.set(block.id, { blocks: thinking, at: now });
  }
  prune(now);
}

/** Thinking blocks to put back before the tool calls of an assistant turn, if they are still known. */
export function recallThinking(toolCallIds: string[]): unknown[] {
  const now = Date.now();
  for (const id of toolCallIds) {
    const entry = store.get(id);
    if (entry && now - entry.at <= TTL_MS) return entry.blocks;
  }
  return [];
}

/** Test helper. */
export function clearThinkingStore(): void {
  store.clear();
}
