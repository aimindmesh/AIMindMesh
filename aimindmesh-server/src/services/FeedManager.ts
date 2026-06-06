import crypto from 'crypto';
import db from '../db/sqlite';
import { Logger } from '../utils/Logger';

export interface FeedItem {
  id: string;
  type: 'INSIGHT' | 'SYSTEM' | 'NOTIFICATION';
  content: string;
  source_node_ids?: string;
  created_at: number;
  read_at: number | null;
  reply_thread_id: string | null;
}

export interface FeedReply {
  id: string;
  feed_item_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
}

export class FeedManager {
  public static getFeed(limit: number = 20, offset: number = 0, unreadOnly: boolean = false): { items: FeedItem[], total: number } {
    let query = `SELECT * FROM feed_items WHERE type != 'NOTIFICATION'`;
    let countQuery = `SELECT COUNT(*) as total FROM feed_items WHERE type != 'NOTIFICATION'`;
    
    if (unreadOnly) {
      query += ` AND read_at IS NULL`;
      countQuery += ` AND read_at IS NULL`;
    }
    
    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    
    const items = db.prepare(query).all(limit, offset) as FeedItem[];
    const countRes = db.prepare(countQuery).get() as { total: number };
    
    Logger.debug('Feed', `Retrieved ${items.length}/${countRes.total} items (unreadOnly: ${unreadOnly})`);
    return { items, total: countRes.total };
  }

  public static markRead(id: string) {
    const stmt = db.prepare(`UPDATE feed_items SET read_at = ? WHERE id = ?`);
    stmt.run(Date.now(), id);
    Logger.debug('Feed', `Item ${id} marked as interpreted`);
  }

  public static addReply(feedItemId: string, role: 'user' | 'assistant', content: string): FeedReply {
    const reply: FeedReply = {
      id: crypto.randomUUID(),
      feed_item_id: feedItemId,
      role,
      content,
      created_at: Date.now()
    };
    
    const stmt = db.prepare(`
      INSERT INTO feed_replies (id, feed_item_id, role, content, created_at)
      VALUES (@id, @feedItemId, @role, @content, @createdAt)
    `);
    
    stmt.run({
      id: reply.id,
      feedItemId: reply.feed_item_id,
      role: reply.role,
      content: reply.content,
      createdAt: reply.created_at
    });
    Logger.info('Feed', `New reply synchronized for thread ${feedItemId} (Role: ${role})`);
    return reply;
  }

  public static getThread(feedItemId: string): { item: FeedItem, replies: FeedReply[] } {
    const item = db.prepare(`SELECT * FROM feed_items WHERE id = ?`).get(feedItemId) as FeedItem;
    if (!item) throw new Error("Feed item not found");
    const replies = db.prepare(`SELECT * FROM feed_replies WHERE feed_item_id = ? ORDER BY created_at ASC`).all(feedItemId) as FeedReply[];
    return { item, replies };
  }

  public static addItem(item: Partial<FeedItem>) {
    const id = item.id || crypto.randomUUID();
    const createdAt = item.created_at || Date.now();
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO feed_items (id, type, content, source_node_ids, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(id, item.type || 'SYSTEM', item.content, item.source_node_ids || null, createdAt);
    Logger.info('Feed', `New item added to synchronized buffer: ${id.slice(0, 8)}...`);
  }
}
