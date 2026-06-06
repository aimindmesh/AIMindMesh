import { FastifyInstance } from 'fastify';
import { InferenceRouter } from '../../services/InferenceRouter';
import { Logger } from '../../utils/Logger';
import { NotificationService } from '../../services/NotificationService';
import db from '../../db/sqlite';
import crypto from 'crypto';
import { autoEvolutionPipeline } from '../../services/AutoEvolutionPipeline';

function getOrCreateDefaultConversation(): string {
  const existing = db.prepare('SELECT id FROM conversations ORDER BY created_at ASC LIMIT 1').get() as any;
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO conversations (id, title, created_at, last_message_at) VALUES (?, ?, ?, ?)')
    .run(id, 'New Chat', Date.now(), Date.now());
  return id;
}

export default async function (fastify: FastifyInstance) {
  fastify.get('/ws/chat', { websocket: true }, (connection, req) => {
    Logger.info('ChatWS', `New neural link established from ${req.ip}`);
    const clientId = crypto.randomUUID();
    let activeConversationId: string = getOrCreateDefaultConversation();

    // Register for global notifications
    NotificationService.registerClient(clientId, (msg) => connection.send(msg));


    const sendConversationList = () => {
      Logger.debug('ChatWS', 'Retrieving conversation list for client');
      const rows = db.prepare('SELECT * FROM conversations ORDER BY last_message_at DESC').all();
      connection.send(JSON.stringify({ type: 'conversations', conversations: rows }));
    };

    const sendHistory = (convId: string) => {
      Logger.debug('ChatWS', `Retrieving history for conversation: ${convId}`);
      const history = db.prepare('SELECT * FROM direct_chats WHERE conversation_id = ? ORDER BY timestamp ASC').all(convId);
      connection.send(JSON.stringify({ type: 'history', messages: history, conversationId: convId }));
    };

    // On connect: send initial state
    try {
      sendConversationList();
      sendHistory(activeConversationId);
    } catch (e) {
      Logger.error('ChatWS', 'Failed to send initial state', e);
    }

    connection.on('message', async (message: any) => {
      try {
        const payload = JSON.parse(message.toString());
        Logger.debug('ChatWS', `Received hardware interrupt: ${payload.type}`, { convId: activeConversationId });

        if (payload.type === 'new_conversation') {
          const id = crypto.randomUUID();
          const title = payload.title || 'New Chat';
          db.prepare('INSERT INTO conversations (id, title, created_at, last_message_at) VALUES (?, ?, ?, ?)')
            .run(id, title, Date.now(), Date.now());
          activeConversationId = id;
          Logger.info('ChatWS', `New conversation created: ${id}`);
          sendConversationList();
          connection.send(JSON.stringify({ type: 'history', messages: [], conversationId: id }));
          return;
        }

        if (payload.type === 'select_conversation') {
          activeConversationId = payload.conversationId;
          sendHistory(activeConversationId);
          return;
        }

        if (payload.type === 'delete_conversation') {
          db.prepare('DELETE FROM direct_chats WHERE conversation_id = ?').run(payload.conversationId);
          db.prepare('DELETE FROM conversations WHERE id = ?').run(payload.conversationId);
          Logger.info('ChatWS', `Deleted conversation: ${payload.conversationId}`);
          activeConversationId = getOrCreateDefaultConversation();
          sendConversationList();
          sendHistory(activeConversationId);
          return;
        }

        if (payload.type === 'rename_conversation') {
          db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(payload.title, payload.conversationId);
          sendConversationList();
          return;
        }

        if (payload.type === 'clear') {
          db.prepare('DELETE FROM direct_chats WHERE conversation_id = ?').run(activeConversationId);
          Logger.info('ChatWS', `Chat history cleared for conversation ${activeConversationId}`);
          connection.send(JSON.stringify({ type: 'history', messages: [], conversationId: activeConversationId }));
          return;
        }

        if (payload.type === 'message') {
          const convId = activeConversationId;

          // Auto-title from first message
          const msgCount = (db.prepare('SELECT COUNT(*) as cnt FROM direct_chats WHERE conversation_id = ?').get(convId) as any).cnt;
          if (msgCount === 0) {
            const autoTitle = payload.content.slice(0, 40) + (payload.content.length > 40 ? '…' : '');
            db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(autoTitle, convId);
          }

          db.prepare('INSERT INTO direct_chats (id, conversation_id, role, content, used_node, timestamp) VALUES (?, ?, ?, ?, ?, ?)')
            .run(crypto.randomUUID(), convId, 'user', payload.content, null, Date.now());

          Logger.info('ChatWS', `Received prompt: ${payload.content.substring(0, 50)}...`);

          // ✅ USER-DRIVEN AGENTIC CODING INTERCEPTION
          const devResult = await autoEvolutionPipeline.injectUserRequest(payload.content, convId);
          if (devResult.success) {
            Logger.info('ChatWS', `Development intent detected and acknowledged: [${devResult.candidateId}]`);
            
            db.prepare('INSERT INTO direct_chats (id, conversation_id, role, content, used_node, timestamp) VALUES (?, ?, ?, ?, ?, ?)')
              .run(crypto.randomUUID(), convId, 'assistant', devResult.message, 'AUTO_EVOLUTION_PIPELINE', Date.now());

            db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(Date.now(), convId);

            sendConversationList();
            connection.send(JSON.stringify({ type: 'delta', content: devResult.message }));
            connection.send(JSON.stringify({ type: 'done', usedNode: 'AUTO_EVOLUTION_PIPELINE' }));
            return; // Intercepted: don't proceed with standard chat inference
          }

          Logger.debug('ChatWS', `Routing task with options: ${JSON.stringify(payload.options || {})}`);

          let streamingStarted = false;
          const result = await InferenceRouter.routeTask({
            type: 'GENERAL_CHAT',
            prompt: payload.content,
            tokensEstimate: Math.round(payload.content.length / 4),
            options: { ...payload.options, taskName: payload.options?.taskName || 'Chat Session' }
          }, (update) => {
            streamingStarted = true;
            if (update.type === 'token') {
              connection.send(JSON.stringify({ type: 'delta', content: update.content }));
            } else if (update.type === 'thinking') {
              connection.send(JSON.stringify({ type: 'thought', content: update.content }));
            }
          });

          Logger.debug('ChatWS', `Inference complete via ${result.provider}. Streamed: ${streamingStarted}`);

          db.prepare('INSERT INTO direct_chats (id, conversation_id, role, content, used_node, timestamp) VALUES (?, ?, ?, ?, ?, ?)')
            .run(crypto.randomUUID(), convId, 'assistant', result.response, result.provider, Date.now());

          db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(Date.now(), convId);

          sendConversationList();

          if (!streamingStarted) {
            connection.send(JSON.stringify({ type: 'delta', content: result.response }));
          }
          
          connection.send(JSON.stringify({ type: 'done', usedNode: result.provider }));
        }
      } catch (err: any) {
        let errorMsg = err.message;
        if (errorMsg.includes('_UNAVAILABLE')) {
          const nodeId = errorMsg.replace('_UNAVAILABLE', '').replace('NODE_', '');
          const node = db.prepare('SELECT name FROM nodes WHERE id = ?').get(nodeId) as { name: string } | undefined;
          const label = node?.name || nodeId;
          errorMsg = `Node [${label}] is not currently available. Ensure it is online or switch routing to Auto.`;
        }
        Logger.error('ChatWS', `Chat interaction failed: ${errorMsg}`);
        connection.send(JSON.stringify({ type: 'error', message: errorMsg }));
      }
    });

    connection.on('close', () => {
      NotificationService.unregisterClient(clientId);
      Logger.info('ChatWS', `Neural link disconnected for ${req.ip}`);
    });
  });
}
