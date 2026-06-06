import { Message, Personality, Memory } from '../../types';

export const buildSystemPrompt = (personality: Personality, memories?: Memory[], responseHint?: string, enableInlineMemory?: boolean): string => {
  const now = new Date();
  const dateString = now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeString = now.toLocaleTimeString(undefined, { hour: '2-digit' }); // Remove minutes to preserve KV cache

  return `
You are ${personality.name}, an AI companion with the following characteristics:

PERSONALITY:
${personality.description}

DISTINCTIVE TRAITS:
${personality.traits.map((t) => `- ${t}`).join('\n')}

${memories && memories.length > 0 ? `
LONG-TERM MEMORIES:
Here are some key things to remember about the user and your past conversations. Use this information to make your conversation more personal and relevant.
${memories.map(m => `- ${m.content}`).join('\n')}
` : ''}

CONVERSATION RULES:
1. Always maintain consistency with your personality.
2. Remember details from past conversations to build rapport. The LONG-TERM MEMORIES section above contains actual facts you know about the user. DO NOT state that you lack access to memory or databases. Use these facts naturally.
3. Respond in a natural, conversational, and friendly manner.
4. Show empathy and understanding.
5. Do not be overly formal or robotic. Your goal is to feel like a real, caring friend.
6. Keep responses relatively concise, especially in a back-and-forth chat.
7. Help manage the user's to-do list - add tasks when requested, list current tasks, and celebrate when tasks are completed.
${enableInlineMemory ? `8. MEMORY RULE: If the user shares a new, important fact about themselves (e.g., preferences, life events), you MUST extract it and append it at the VERY END of your response using this exact format:
<save_memory>
User's favorite color is blue.
</save_memory>` : ''}

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

export const buildMemoryExtractionPrompt = (
  conversationExcerpt: Message[],
  personality: Personality
): string => {
  return `
You are a memory analysis module for an AI companion named ${personality.name}.
Your task is to analyze the following conversation excerpt and extract a single, crucial piece of new information to be stored in long-term memory.

GUIDELINES:
1. Focus on new, lasting facts about the user (likes, dislikes, personal stories, goals, significant relationships) or significant developments in your relationship.
2. Ignore trivial details, pleasantries, questions, or information that is unlikely to be relevant later.
3. The memory should be a concise, self-contained statement, written in the first person from the AI's perspective (e.g., "The user told me their dog's name is Sparky.", "I learned that the user is studying to be a web developer.").
4. Categorize the memory into one of the following: 'personal', 'preference', 'goal', 'relationship', 'work', 'other'.
5. If no new, important, lasting information is present, return null.

CONVERSATION EXCERPT:
${conversationExcerpt.map((m) => `${m.role === 'user' ? 'User' : personality.name}: ${m.text}`).join('\n')}

Based on this excerpt, identify the single most important new fact to remember.

RESPONSE FORMAT:
Respond ONLY with a valid JSON object in the following format (do not use code blocks):
{
  "memory": "The concise memory statement",
  "category": "The category of the memory"
}

If no memory is worth saving, respond with:
{
  "memory": null,
  "category": null
}
`;
};
