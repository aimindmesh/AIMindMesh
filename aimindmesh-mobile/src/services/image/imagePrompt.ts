import { ImageAttachment, Message } from '../../types';

/**
 * Prompts and source images for Stable Diffusion requests coming from the chat.
 *
 * SD 2.x understands English only, and it cannot follow instructions ("make the sky red"):
 * it needs a description of the picture to produce. The chat LLM, still in RAM when /image or
 * /edit arrives, rewrites the request before Stable Diffusion takes its place.
 */

/** Used when a chat request has no negative prompt (the image screen uses its style presets) */
export const DEFAULT_NEGATIVE_PROMPT =
    'low quality, worst quality, blurry, deformed, distorted, disfigured, bad anatomy, extra limbs, watermark, text';

const MAX_PROMPT_LENGTH = 400;

function instruction(text: string, mode: 'generate' | 'edit'): string {
    const task = mode === 'generate'
        ? 'Rewrite this request as a Stable Diffusion prompt in English: one line of comma-separated phrases describing subject, setting, style and lighting. Keep every detail the user gave and add no new subjects.'
        : 'The user wants to edit a picture with Stable Diffusion img2img, which cannot follow instructions: it needs a description of the final picture. Rewrite this request as one English line describing how the edited picture should look (e.g. "make the sky red" -> "a landscape under a deep red sky").';
    return `${task} If it is not in English, translate it. Reply with the prompt only, no quotes or explanations.\n\nRequest: ${text}`;
}

/** First meaningful line of the model's answer, without reasoning, quotes or labels. */
export function cleanRewrittenPrompt(raw: string): string {
    const withoutThinking = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '');
    const line = withoutThinking.split('\n').map(l => l.trim()).find(l => l.length > 0) ?? '';
    return line
        .replace(/^(prompt|stable diffusion prompt|description)\s*:\s*/i, '')
        .replace(/^["'`“”«]+|["'`“”»]+$/g, '')
        .trim()
        .slice(0, MAX_PROMPT_LENGTH);
}

/**
 * The request as an English Stable Diffusion prompt; the original text when the model is not
 * available, too slow or answers nothing usable.
 */
export async function rewriteImagePrompt(
    text: string,
    mode: 'generate' | 'edit',
    complete: (prompt: string) => Promise<string>,
    timeoutMs = 20000
): Promise<string> {
    const original = text.trim();
    if (!original) return original;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const answer = await Promise.race([
            complete(instruction(original, mode)),
            new Promise<string>(resolve => { timer = setTimeout(() => resolve(''), timeoutMs); }),
        ]);
        const cleaned = cleanRewrittenPrompt(answer || '');
        return cleaned.length >= 3 ? cleaned : original;
    } catch {
        return original;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function looksLikeImageData(value: string): boolean {
    return /^(data:|\/|file:\/\/|content:\/\/|https?:\/\/localhost)/i.test(value) || (value.length > 200 && /^[A-Za-z0-9+/=\s]+$/.test(value));
}

function toDataUrl(image: ImageAttachment): string | undefined {
    if (image.base64) return image.base64.startsWith('data:') ? image.base64 : `data:${image.mimeType || 'image/png'};base64,${image.base64}`;
    return image.webPath;
}

/**
 * The image a generate_image call should edit. The model cannot copy pixels into its arguments,
 * so it refers to them by keyword ("last"): the newest image of this run, else of the chat.
 */
export function resolveToolSourceImage(
    value: unknown,
    history: Message[],
    generatedThisRun: ImageAttachment[] = []
): { source?: string; error?: string } {
    if (typeof value !== 'string' || !value.trim()) return {};
    const requested = value.trim();
    if (looksLikeImageData(requested)) return { source: requested };
    // "last", "attached" or a description ("the user's photo"): the newest image is the one meant
    const newest = [...generatedThisRun].reverse()[0]
        ?? [...history].reverse().find(m => m.images && m.images.length > 0)?.images?.slice(-1)[0];
    const source = newest ? toDataUrl(newest) : undefined;
    return source ? { source } : { error: 'There is no image in this conversation to edit: ask the user to attach one.' };
}

/** The picture a tool produced, as a chat attachment. */
export function imageFromToolData(data: unknown): ImageAttachment | null {
    const image = (data as { base64Image?: unknown } | undefined)?.base64Image;
    if (typeof image !== 'string' || !image) return null;
    const match = /^data:(image\/[\w+.-]+);base64,/.exec(image);
    const mimeType = match?.[1] ?? 'image/png';
    return {
        name: `generated_${Date.now()}.${mimeType === 'image/jpeg' ? 'jpg' : 'png'}`,
        base64: image.replace(/^data:image\/[\w+.-]+;base64,/, ''),
        mimeType,
    };
}
