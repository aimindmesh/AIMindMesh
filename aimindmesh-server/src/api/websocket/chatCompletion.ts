import { InferenceRouter } from '../../services/InferenceRouter';
import { Logger } from '../../utils/Logger';
import { normalizeRouting } from '../../utils/routing';
import { buildChatPrompt } from '../../utils/chatPrompt';

import type { ChatCompletionEvent, ChatCompletionRequest } from '../../types/api';

/**
 * Stateless streaming completion on /ws/chat?mode=completion (mobile app chats): same prompt
 * and routing as POST /api/chat, nothing is persisted (the app keeps its own threads and syncs
 * them). `ack` tells the client the request was accepted (old servers never send it, and the
 * client then falls back to REST); every event carries the requestId.
 */
export async function handleCompletion(send: (msg: ChatCompletionEvent) => void, req: ChatCompletionRequest): Promise<void> {
  const requestId = String(req.requestId ?? '');
  if (!Array.isArray(req.messages) || req.messages.length === 0) {
    send({ type: 'error', requestId, message: 'messages is required' });
    return;
  }
  send({ type: 'ack', requestId });
  const prompt = buildChatPrompt(req.messages);
  let streamedText = false;
  try {
    const result = await InferenceRouter.routeTask({
      type: 'GENERAL_CHAT',
      prompt,
      tokensEstimate: Math.round(prompt.length / 4),
      options: {
        taskName: 'User Chat Response',
        routing: normalizeRouting(req.options?.routing),
        thinking: req.options?.thinking === true,
        searchEnabled: req.options?.searchEnabled === true,
      },
    }, update => {
      if (update.type === 'token') {
        streamedText = true;
        send({ type: 'delta', requestId, content: update.content });
      } else if (update.type === 'thinking') {
        send({ type: 'thought', requestId, content: update.content });
      }
    });
    // Providers that do not stream: the whole answer as one delta
    if (!streamedText && result.response) send({ type: 'delta', requestId, content: result.response });
    send({ type: 'done', requestId, usedNode: result.provider });
  } catch (err: any) {
    Logger.error('ChatWS', `Completion ${requestId} failed: ${err.message}`);
    send({ type: 'error', requestId, message: err.message });
  }
}
