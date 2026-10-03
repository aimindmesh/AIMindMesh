/** Flattens a chat history into the single prompt the InferenceRouter takes (REST and WS share it). */
export function buildChatPrompt(messages: { role: string; content: string }[]): string {
  return messages.map(m => `${m.role}: ${m.content}`).join('\n');
}
