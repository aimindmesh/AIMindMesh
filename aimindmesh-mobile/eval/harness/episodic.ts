/** Past-conversation memories the mocked episodic retriever returns for the current scenario */
export const episodic = { memories: [] as Array<{ content: string; role: string; similarity: number; timestamp: number }> };

export function setEpisodic(texts: string[] | undefined) {
    episodic.memories = (texts ?? []).map((content, i) => ({ content, role: 'user', similarity: 0.9 - i * 0.01, timestamp: Date.UTC(2026, 8, 20) }));
}
