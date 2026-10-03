import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/InferenceRouter', () => ({ InferenceRouter: { routeTask: vi.fn(), setBrake: vi.fn() } }));
vi.mock('../src/services/FCMDispatcher', () => ({ sendToDevice: vi.fn() }));
vi.mock('../src/services/SearchService', () => ({ SearchService: {} }));

import db from '../src/db/sqlite';
import { FeedManager } from '../src/services/FeedManager';
import { DebateEngine } from '../src/services/DebateEngine';
import { deleteConversation } from '../src/services/conversations';

const count = (sql: string, ...params: unknown[]) => (db.prepare(sql).get(...params) as { c: number }).c;

function insight(id: string, createdAt: number, nodes = '["n1"]') {
  db.prepare(`INSERT INTO feed_items (id, type, content, source_node_ids, created_at) VALUES (?, 'INSIGHT', ?, ?, ?)`)
    .run(id, `content ${id}`, nodes, createdAt);
}
function pendingDelivery(insightId: string) {
  db.prepare(`INSERT INTO pending_delivery (id, insight_id, device_id, created_at) VALUES (?, ?, 'phone', 0)`)
    .run(`pd-${insightId}`, insightId);
}
function thread(id: string, insightId: string) {
  db.prepare(`INSERT INTO debate_threads (id, insight_id, insight_content, created_at, updated_at) VALUES (?, ?, 'c', 0, 0)`).run(id, insightId);
  db.prepare(`INSERT INTO debate_messages (id, debate_id, author, content, round, created_at) VALUES (?, ?, 'a', 'm', 1, 0)`).run(`msg-${id}`, id);
}

beforeEach(() => {
  db.exec(`DELETE FROM pending_delivery; DELETE FROM feed_replies; DELETE FROM debate_messages; DELETE FROM debate_threads;
           DELETE FROM feed_items; DELETE FROM direct_chats; DELETE FROM conversations;`);
});

describe('deletes that used to violate foreign keys', () => {
  it('deleting a feed item drops its queued deliveries and replies', () => {
    insight('i1', 1);
    pendingDelivery('i1');
    db.prepare(`INSERT INTO feed_replies (id, feed_item_id, role, content) VALUES ('r1', 'i1', 'user', 'hi')`).run();

    expect(FeedManager.deleteItem('i1')).toBe(true);
    expect(count(`SELECT COUNT(*) AS c FROM pending_delivery`)).toBe(0);
    expect(count(`SELECT COUNT(*) AS c FROM feed_replies`)).toBe(0);
    expect(FeedManager.deleteItem('i1')).toBe(false);
  });

  it('merging duplicate insights moves messages and replies, drops deliveries of the obsolete one', async () => {
    insight('new', 2);
    insight('old', 1); // same source nodes: deterministic duplicate, no LLM involved
    thread('t-new', 'new');
    thread('t-old', 'old');
    pendingDelivery('old');
    db.prepare(`INSERT INTO feed_replies (id, feed_item_id, role, content) VALUES ('r1', 'old', 'user', 'hi')`).run();

    await DebateEngine.runMergeCycle();

    expect(count(`SELECT COUNT(*) AS c FROM feed_items`)).toBe(1);
    expect(count(`SELECT COUNT(*) AS c FROM feed_items WHERE id = 'new'`)).toBe(1);
    expect(count(`SELECT COUNT(*) AS c FROM pending_delivery`)).toBe(0);
    expect(count(`SELECT COUNT(*) AS c FROM debate_messages WHERE debate_id = 't-new'`)).toBe(2);
    expect(count(`SELECT COUNT(*) AS c FROM feed_replies WHERE feed_item_id = 'new'`)).toBe(1);
    expect(db.prepare(`SELECT status, merged_into FROM debate_threads WHERE id = 't-old'`).get())
      .toEqual({ status: 'CLOSED', merged_into: 't-new' });
  });

  it('deleting a conversation removes its messages in the same transaction', () => {
    db.prepare(`INSERT INTO conversations (id, title, created_at) VALUES ('c1', 't', 0), ('c2', 't', 0)`).run();
    db.prepare(`INSERT INTO direct_chats (id, conversation_id, role, content, timestamp) VALUES ('m1', 'c1', 'user', 'x', 0), ('m2', 'c2', 'user', 'y', 0)`).run();

    deleteConversation('c1');

    expect(count(`SELECT COUNT(*) AS c FROM conversations`)).toBe(1);
    expect(db.prepare(`SELECT id FROM direct_chats`).all()).toEqual([{ id: 'm2' }]);
  });
});

describe('contextual delivery', () => {
  it('returns the insight text the device shows in its notification', async () => {
    const { DeliveryScheduler } = await import('../src/services/DeliveryScheduler');
    insight('i1', 1);
    pendingDelivery('i1');
    expect(DeliveryScheduler.getPendingForDevice('phone')).toEqual([
      { id: 'pd-i1', insightId: 'i1', deviceId: 'phone', createdAt: 0, content: 'content i1' },
    ]);
  });
});
