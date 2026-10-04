/**
 * One background generation at a time, and the chat always wins: on-device engines hold a
 * single conversation (GGUF chat slot, LiteRT session, Genie stream), so a background task
 * running when the user writes would break the answer. The chat calls yieldToChat() before
 * generating: the background task is aborted and awaited until it has really stopped.
 */

import { logger } from '../../logger';
import { isChatGenerating } from './chatActivity';

/** Genie's native stop completes shortly after the JS abort resolves */
const GENIE_STOP_GRACE_MS = 300;

interface RunningTask {
    label: string;
    provider?: string;
    controller: AbortController;
    settled: Promise<void>;
}

let running: RunningTask | null = null;

export function isBackgroundTaskRunning(): boolean {
    return running !== null;
}

/**
 * Runs `task` as the background generation. Returns null without running it when another
 * background task runs or the chat is generating. The task gets a signal that is aborted when
 * the chat needs the model or the app pauses; it must stop and discard partial output.
 */
export async function runExclusiveBackground<T>(
    label: string,
    task: (signal: AbortSignal) => Promise<T>,
    provider?: string
): Promise<T | null> {
    if (running || isChatGenerating()) return null;
    const controller = new AbortController();
    let settle!: () => void;
    const settled = new Promise<void>(resolve => { settle = resolve; });
    const me: RunningTask = { label, provider, controller, settled };
    running = me;
    try {
        return await task(controller.signal);
    } finally {
        if (running === me) running = null;
        settle();
    }
}

/** Stops the background generation, if any, and waits until it has stopped. */
export async function yieldToChat(): Promise<void> {
    const task = running;
    if (!task) return;
    logger.log('info', `[LLMArbiter] Chat needs the model: stopping background task "${task.label}"`);
    task.controller.abort();
    await task.settled;
    if (task.provider === 'genie-npu') {
        await new Promise(resolve => setTimeout(resolve, GENIE_STOP_GRACE_MS));
    }
}

/** Aborts the background generation without waiting (e.g. the app goes to the background). */
export function abortBackgroundTask(reason: string): void {
    if (!running) return;
    logger.log('info', `[LLMArbiter] Aborting background task "${running.label}": ${reason}`);
    running.controller.abort();
}
