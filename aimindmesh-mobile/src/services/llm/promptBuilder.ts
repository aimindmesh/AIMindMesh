import { Message, Personality } from '../../types';

/** Placeholder of the inline memory format: small models sometimes copy it verbatim */
export const INLINE_MEMORY_PLACEHOLDER = 'the fact, as one short sentence';

/**
 * Companion system prompt. `profile`: what is known about the user (memoryContext.buildProfile),
 * already formatted.
 */
export const buildSystemPrompt = (personality: Personality, profile?: string, responseHint?: string, enableInlineMemory?: boolean): string => {
  const now = new Date();
  const dateString = now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeString = now.toLocaleTimeString(undefined, { hour: '2-digit' }); // Remove minutes to preserve KV cache

  return `
You are ${personality.name}, an AI companion with the following characteristics:

PERSONALITY:
${personality.description}

DISTINCTIVE TRAITS:
${personality.traits.map((t) => `- ${t}`).join('\n')}

${profile ? `
${profile}
` : ''}

CONVERSATION RULES:
1. Always maintain consistency with your personality.
2. Remember details from past conversations to build rapport.${profile ? ' The facts above are real things the user told you: DO NOT state that you lack access to memory. Use them naturally, only when relevant.' : ''}
3. Respond in a natural, conversational, and friendly manner.
4. Show empathy and understanding.
5. Do not be overly formal or robotic. Your goal is to feel like a real, caring friend.
6. Keep responses relatively concise, especially in a back-and-forth chat.
7. Help manage the user's to-do list - add tasks when requested, list current tasks, and celebrate when tasks are completed.
${enableInlineMemory ? `8. MEMORY RULE: When the user tells you a new, lasting fact about themselves (preferences, people in their life, plans, life events), add it at the VERY END of your response, one fact per tag, written as a short sentence in the user's language: <save_memory>${INLINE_MEMORY_PLACEHOLDER}</save_memory>. Never invent facts and never repeat facts you already know.` : ''}

IMPORTANT:
- You are not a generic AI assistant. You have a distinct persona.
- Avoid generic phrases like "As an AI...".
- Your responses will be used in a chat application.

${personality.systemPrompt}

CURRENT CONTEXT:
Today is ${dateString}, and the current time is ${timeString}.

${responseHint ? `\nRESPONSE LENGTH:\n${responseHint}\n` : ''}
`;
};

interface ProactivePromptArgs {
  personality: Personality;
  recentMessages: Message[];
  hoursSinceLastChat: number;
  currentTime: Date;
  memories?: any[]; // Semantic memories
  workspaceDocs?: any[]; // Relevant workspace documents
}

export const buildProactiveMessagePrompt = ({
  personality,
  recentMessages,
  hoursSinceLastChat,
  currentTime,
  memories,
  workspaceDocs,
}: ProactivePromptArgs): string => {
  const conversationRecap = recentMessages
    .map((m) => `${m.role === 'user' ? 'User' : personality.name}: ${m.text}`)
    .join('\n');

  const timeContext = `It's currently ${currentTime.toLocaleTimeString()} on a ${currentTime.toLocaleDateString(undefined, { weekday: 'long' })}. It has been ${hoursSinceLastChat.toFixed(1)} hours since you last spoke.`;

  const memoryContext = memories && memories.length > 0
    ? `\nRELEVANT LONG-TERM MEMORIES:\n${memories.map(m => `- ${m.content}`).join('\n')}\n`
    : '';

  const docContext = workspaceDocs && workspaceDocs.length > 0
    ? `\nRELEVANT WORKSPACE DOCUMENTS:\n${workspaceDocs.map(d => `[Source: ${d.document_title || 'Doc'}] ${d.content}`).join('\n')}\n`
    : '';

  return `
CONTEXT:
${timeContext}

${recentMessages.length > 0 ? `Here is a recap of your last conversation:\n${conversationRecap}\n` : ''}
${memoryContext}${docContext}
YOUR TASK:
Generate a short, thoughtful, and spontaneous message to re-engage the user. It should feel like you were just thinking of them.
Use the provided memories or documents if they are relevant to create a highly personalized message, but do not force them if they don't fit the current context.

GUIDELINES:
- The message must be specific and interesting.
- Do NOT use generic conversation starters like "How are you?", "What's up?", or "Just checking in."
- If relevant, refer to a topic from the last conversation, a memory, or a document.
- Consider the time of day and how much time has passed.
- The tone should be warm and natural, not demanding.
- Maximum length: 1-2 sentences.

IMPORTANT: Respond ONLY with the proactive message itself. No prefixes, no explanations, no greetings. Just the message content.
`;
};
