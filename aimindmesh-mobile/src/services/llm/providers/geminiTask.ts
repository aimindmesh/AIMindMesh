import { GoogleGenAI, createPartFromUri, FileState } from '@google/genai';
import { logger } from '../../logger';
import type { TaskRequest } from '../taskCompletion';

/**
 * Gemini for app tasks (meeting notes): streamed, with a JSON answer when asked, and recordings
 * as input. Recordings up to this size are sent inline; larger ones go through the Files API
 * (inline requests are limited to 20 MB in total, and base64 adds a third).
 */
const INLINE_AUDIO_LIMIT_BYTES = 14 * 1024 * 1024;

let client: GoogleGenAI | null = null;
let clientKey: string | null = null;

function getClient(apiKey?: string): GoogleGenAI {
    const key = apiKey?.trim();
    if (!key) throw new Error('Gemini API key is not configured. Please set it in Settings.');
    if (!client || clientKey !== key) {
        client = new GoogleGenAI({ apiKey: key });
        clientKey = key;
    }
    return client;
}

export function resolveGeminiTaskModel(configured?: string): string {
    return configured?.trim() || 'gemini-2.5-flash';
}

function generationConfig(req: TaskRequest) {
    return {
        systemInstruction: req.system,
        temperature: 0.3,
        maxOutputTokens: req.maxTokens,
        ...(req.json ? { responseMimeType: 'application/json' } : {}),
        abortSignal: req.signal,
    };
}

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const aborted = () => new DOMException('Aborted by user', 'AbortError');

export async function* geminiTaskStream(req: TaskRequest, audio?: { blob: Blob; mimeType: string }): AsyncGenerator<string> {
    const ai = getClient(req.keys.gemini);
    let uploadedName: string | undefined;
    const parts: any[] = [];

    if (audio) {
        if (audio.blob.size <= INLINE_AUDIO_LIMIT_BYTES) {
            parts.push({ inlineData: { mimeType: audio.mimeType, data: await blobToBase64(audio.blob) } });
        } else {
            logger.log('info', `[GeminiTask] Uploading ${Math.round(audio.blob.size / 1e6)} MB of audio to the Files API`);
            let file = await ai.files.upload({ file: audio.blob, config: { mimeType: audio.mimeType } });
            uploadedName = file.name;
            // Audio is processed before it can be used
            for (let i = 0; file.state === FileState.PROCESSING && i < 120; i++) {
                if (req.signal?.aborted) throw aborted();
                await sleep(2000);
                file = await ai.files.get({ name: file.name! });
            }
            if (file.state !== FileState.ACTIVE || !file.uri) {
                throw new Error(`Gemini could not process the recording (${file.state ?? 'unknown state'})`);
            }
            parts.push(createPartFromUri(file.uri, file.mimeType || audio.mimeType));
        }
    }
    parts.push({ text: req.prompt });

    try {
        const stream = await ai.models.generateContentStream({
            model: resolveGeminiTaskModel(req.llmConfig.geminiModel),
            contents: [{ role: 'user', parts }],
            config: generationConfig(req),
        });
        for await (const chunk of stream) {
            if (req.signal?.aborted) throw aborted();
            if (chunk.text) yield chunk.text;
        }
    } finally {
        // Files expire after 48 h anyway; the meeting doesn't stay there longer than needed
        if (uploadedName) ai.files.delete({ name: uploadedName }).catch(() => { });
    }
}
