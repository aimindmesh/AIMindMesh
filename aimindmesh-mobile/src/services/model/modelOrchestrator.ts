import { logger } from '../logger';

/**
 * Which heavy models may be in RAM together.
 *
 * The phone cannot hold an LLM, Stable Diffusion and a large speech model at once. Every
 * heavy load goes through ensureResident(), which first unloads whatever conflicts with it,
 * and features declare their activity: entering image generation frees the LLM, leaving it
 * frees Stable Diffusion and brings the configured chat LLM back.
 *
 * Rules (deterministic, no RAM estimates):
 * - two heavy engines are never resident together (an LLM engine, Stable Diffusion, Voxtral,
 *   a medium/large Whisper);
 * - a light Whisper model (tiny/base/small) may stay next to the LLM;
 * - light models (Vosk, Piper, Kokoro, VAD, embeddings, speaker embedding, wake word) are not
 *   managed here: they are small and loaded by their own features.
 *
 * Engine services are imported lazily: they import this module to call ensureResident().
 */

export type HeavyEngine = 'gguf' | 'litert' | 'genie' | 'sd' | 'whisper' | 'voxtral';
export type Activity = 'chat' | 'image' | 'meeting' | 'voice';

/** The local LLM engines: in chat one of them is the configured model */
export const LLM_ENGINES: HeavyEngine[] = ['gguf', 'litert', 'genie'];

interface EngineHooks {
    isLoaded(): Promise<boolean>;
    unload(): Promise<void>;
}

const hooks: Record<HeavyEngine, EngineHooks> = {
    gguf: {
        isLoaded: async () => (await import('../llm/nativeLLM')).getLoadedSlots().length > 0,
        // All native contexts, also those a previous WebView session left behind
        unload: async () => (await import('../llm/nativeLLM')).forceReleaseAllContexts(),
    },
    litert: {
        isLoaded: async () => (await import('../llm/providers/liteRT/plugin')).isLiteRTLoaded(),
        unload: async () => (await import('../llm/providers/liteRT/plugin')).releaseLiteRTModel(),
    },
    genie: {
        isLoaded: async () => (await import('../llm/providers/genieProvider')).isGenieModelLoaded(),
        unload: async () => (await import('../llm/providers/genieProvider')).unloadGenieModel(),
    },
    sd: {
        isLoaded: async () => (await import('../image/imageGenService')).imageGenService.isModelLoaded(),
        unload: async () => (await import('../image/imageGenService')).imageGenService.unloadModel(),
    },
    whisper: {
        isLoaded: async () => (await import('../stt/whisperSTT')).getWhisperSTTService().isModelLoaded(),
        unload: async () => (await import('../stt/whisperSTT')).getWhisperSTTService().unloadModel(),
    },
    voxtral: {
        isLoaded: async () => (await import('../stt/voxtralSTT')).getVoxtralSttService().checkModelLoaded(),
        unload: async () => (await import('../stt/voxtralSTT')).getVoxtralSttService().unloadModel(),
    },
};

/** Engines loaded through ensureResident, with their weight */
const resident = new Map<HeavyEngine, { heavy: boolean }>();
const pins = new Map<HeavyEngine, number>();
let activity: Activity = 'chat';
/** Heavy engines the current activity needs (chat: the LLM engines) */
let activityKeep: HeavyEngine[] = LLM_ENGINES;
const activityDepth = new Map<Activity, number>();
let llmRestorer: (() => Promise<void>) | null = null;

export type TransitionEvent =
    | { phase: 'unloading'; engine: HeavyEngine; reason: string }
    | { phase: 'loading'; engine: HeavyEngine }
    | { phase: 'activity'; activity: Activity };
const listeners = new Set<(event: TransitionEvent) => void>();

export function onModelTransition(listener: (event: TransitionEvent) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
function emit(event: TransitionEvent) {
    listeners.forEach(listener => {
        try { listener(event); } catch { /* a UI listener never breaks a transition */ }
    });
}

// Transitions run one at a time: two features never load or unload concurrently
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
}

/** Thrown when a model needed by a running task (a recording) would have to be unloaded */
export class ModelBusyError extends Error {}

const ENGINE_LABELS: Record<HeavyEngine, string> = {
    gguf: 'chat model (GGUF)', litert: 'chat model (LiteRT)', genie: 'chat model (Genie NPU)',
    sd: 'image model', whisper: 'Whisper speech model', voxtral: 'Voxtral speech model',
};

async function isResident(engine: HeavyEngine): Promise<boolean> {
    if (resident.has(engine)) return true;
    try {
        return await hooks[engine].isLoaded();
    } catch {
        return false;
    }
}

/** Two heavy engines never stay together; a light Whisper may stay next to anything. */
function conflicts(engine: HeavyEngine, heavy: boolean, other: HeavyEngine): boolean {
    if (engine === other || !heavy) return false;
    // A Whisper loaded outside ensureResident (unknown size) counts as heavy
    return resident.get(other)?.heavy ?? true;
}

async function unloadEngine(engine: HeavyEngine, reason: string): Promise<void> {
    if ((pins.get(engine) ?? 0) > 0) {
        throw new ModelBusyError(`The ${ENGINE_LABELS[engine]} is in use by a recording and cannot leave the RAM (${reason}). Stop the recording first.`);
    }
    if (!(await isResident(engine))) {
        resident.delete(engine);
        return;
    }
    logger.log('info', `[ModelOrchestrator] Unloading ${engine} (${reason})`);
    emit({ phase: 'unloading', engine, reason });
    try {
        await hooks[engine].unload();
    } catch (error) {
        logger.log('warn', `[ModelOrchestrator] Unloading ${engine} failed`, error);
    }
    resident.delete(engine);
}

/**
 * Called by an engine service right before it loads a model: unloads every resident engine
 * that cannot stay next to it. Throws ModelBusyError if one of them is pinned.
 */
export function ensureResident(engine: HeavyEngine, options: { heavy?: boolean } = {}): Promise<void> {
    const heavy = options.heavy ?? engine !== 'whisper';
    return serialized(async () => {
        for (const other of Object.keys(hooks) as HeavyEngine[]) {
            if (conflicts(engine, heavy, other)) await unloadEngine(other, `loading the ${ENGINE_LABELS[engine]}`);
        }
        resident.set(engine, { heavy });
        emit({ phase: 'loading', engine });
    });
}

/** Called by an engine service after it unloaded its model by itself (settings, idle). */
export function markUnloaded(engine: HeavyEngine): void {
    resident.delete(engine);
}

/** Keeps an engine resident while a task needs it (a meeting recording). Returns the unpin. */
export function pin(engine: HeavyEngine): () => void {
    pins.set(engine, (pins.get(engine) ?? 0) + 1);
    let released = false;
    return () => {
        if (released) return;
        released = true;
        pins.set(engine, Math.max(0, (pins.get(engine) ?? 1) - 1));
    };
}

export function getActivity(): Activity {
    return activity;
}

/** The function that loads the configured chat LLM (set at startup by useModelLoader). */
export function registerLlmRestorer(restore: (() => Promise<void>) | null): void {
    llmRestorer = restore;
}

/**
 * Enters a feature: unloads every heavy engine it does not keep (pinned ones stay and
 * make this throw). Nested enters of the same activity are counted.
 */
export function enterActivity(next: Activity, keep: HeavyEngine[]): Promise<void> {
    activityDepth.set(next, (activityDepth.get(next) ?? 0) + 1);
    return serialized(async () => {
        activity = next;
        activityKeep = keep;
        emit({ phase: 'activity', activity: next });
        for (const engine of Object.keys(hooks) as HeavyEngine[]) {
            if (!keep.includes(engine)) await unloadEngine(engine, `entering ${next}`);
        }
    });
}

/**
 * Leaves a feature: unloads its engines (everything but the LLM engines) and brings the
 * configured LLM back in the background, so the chat is ready again.
 */
export async function leaveActivity(left: Activity): Promise<void> {
    const depth = Math.max(0, (activityDepth.get(left) ?? 1) - 1);
    activityDepth.set(left, depth);
    if (depth > 0 || activity !== left) return;
    await serialized(async () => {
        activity = 'chat';
        activityKeep = LLM_ENGINES;
        emit({ phase: 'activity', activity: 'chat' });
        for (const engine of Object.keys(hooks) as HeavyEngine[]) {
            if (!LLM_ENGINES.includes(engine)) await unloadEngine(engine, `leaving ${left}`).catch(error => {
                logger.log('warn', `[ModelOrchestrator] ${engine} kept after leaving ${left}`, error);
            });
        }
    });
    restoreChatModel();
}

/** Loads the configured chat LLM in the background (never awaited inside the queue). */
export function restoreChatModel(): void {
    if (!llmRestorer || activity !== 'chat') return;
    llmRestorer().catch(error => logger.log('warn', '[ModelOrchestrator] Chat model not restored', error));
}

/**
 * Android reports memory pressure. 'idle' (running critically low, app in foreground): unload
 * the heavy engines the current activity does not need. 'all' (app in background and next to
 * be killed): unload every engine no task is using — a reload costs less than being killed.
 */
export function releaseForMemoryPressure(scope: 'idle' | 'all'): Promise<void> {
    return serialized(async () => {
        for (const engine of Object.keys(hooks) as HeavyEngine[]) {
            if ((pins.get(engine) ?? 0) > 0) continue;
            if (scope === 'idle' && activityKeep.includes(engine)) continue;
            await unloadEngine(engine, 'memory pressure');
        }
    });
}

/** Unloads the given engines (e.g. the local LLMs when the chat moved to a cloud provider). */
export function unloadEngines(engines: HeavyEngine[], reason: string): Promise<void> {
    return serialized(async () => {
        for (const engine of engines) {
            await unloadEngine(engine, reason).catch(error => logger.log('warn', `[ModelOrchestrator] ${engine} kept`, error));
        }
    });
}

/** Whisper medium/large models are heavy; tiny/base/small are not. */
export function isHeavyWhisperModel(modelId: string | undefined | null): boolean {
    return !!modelId && /(medium|large)/i.test(modelId);
}

/** Tests only */
export function resetModelOrchestratorForTests(): void {
    resident.clear();
    pins.clear();
    activityDepth.clear();
    activity = 'chat';
    activityKeep = LLM_ENGINES;
    llmRestorer = null;
    listeners.clear();
    queue = Promise.resolve();
}
