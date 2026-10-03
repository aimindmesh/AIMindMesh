import db from '../db/sqlite';

/** Deletes a conversation together with its messages, atomically (REST and WebSocket share it). */
export function deleteConversation(id: string) {
  db.transaction(() => {
    db.prepare('DELETE FROM direct_chats WHERE conversation_id = ?').run(id);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
  })();
}
