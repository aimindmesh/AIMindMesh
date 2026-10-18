import { NodeRegistry } from '../NodeRegistry';
import { sendToDevice } from '../FCMDispatcher';
import { Logger } from '../../utils/Logger';
import { routerState } from './routerState';
import type { QueueItem } from './routerTypes';

/** Sends a task to a phone node over its socket and waits for the node's result (up to 24 h). */
export function dispatchMobile(item: QueueItem, provider: string): Promise<string> {
  const { id, payload } = item;
  const socket = routerState.nodeSockets.get(provider);
  if (!socket || socket.readyState !== 1) return Promise.reject(new Error(`NODE_${provider}_DISCONNECTED`));

  return new Promise((res, rej) => {
    // 24 hours timeout for mobile nodes - user requested long duration
    const timeout = setTimeout(() => { cleanup(); rej(new Error('Mobile timeout after 24h')); }, 24 * 60 * 60 * 1000);
    const onDisconnect = () => { cleanup(); rej(new Error(`NODE_${provider}_DISCONNECTED`)); };
    const cleanup = () => {
      clearTimeout(timeout);
      routerState.pendingMobileTasks.delete(id);
    };

    routerState.pendingMobileTasks.set(id, {
      callback: (result: any) => { cleanup(); if (result.error) rej(new Error(result.error)); else res(result.reply || ''); },
      onUpdate: item.onUpdate,
      cleanup,
      node: provider
    });

    socket.once?.('close', onDisconnect);
    socket.send(JSON.stringify({ type: 'task', id, payload }));
  });
}

/** Wakes an offline node through FCM, when it registered a token. */
export async function attemptWakeup(id: string, provider: string): Promise<void> {
  const node = NodeRegistry.getNodes().find(n => n.id === provider);
  if (node?.fcm_token) {
    await sendToDevice(node.fcm_token, { title: 'Synaptic Link', body: 'Waking up node...', data: { type: 'WAKE_FOR_INFERENCE', taskId: id } });
  }
}

/** Streams a token or a thought of a phone task back to its caller. */
export function onTaskUpdate(taskId: string, update: { type: 'token' | 'thinking', content: string }): void {
  const task = routerState.pendingMobileTasks.get(taskId);
  if (task && task.onUpdate) {
    task.onUpdate(update);
  }
}

/**
 * Handle node disconnection: fail all tasks that were being processed by this node
 * so they can be retried or re-routed.
 */
export function handleNodeDisconnection(nodeId: string): void {
  const nodeUpper = nodeId.toUpperCase();
  const tasksToRecover: string[] = [];

  // Find all tasks assigned to this node in our pending map
  for (const [id, pending] of routerState.pendingMobileTasks.entries()) {
    if (pending.node.toUpperCase() === nodeUpper) {
      tasksToRecover.push(id);
    }
  }

  if (tasksToRecover.length === 0) return;

  Logger.warn('InferenceRouter', `[SYNC] Node [${nodeUpper}] disconnected. Recovering ${tasksToRecover.length} processing tasks...`);

  for (const id of tasksToRecover) {
    const pending = routerState.pendingMobileTasks.get(id);
    if (pending) {
      // Trigger failure on the pending promise so it can retry
      pending.callback({ error: `NODE_DISCONNECTED: Worker ${nodeUpper} went offline during processing` });
      routerState.pendingMobileTasks.delete(id);
    }
  }
}
