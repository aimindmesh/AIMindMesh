/**
 * Chat image attachments are stored inline (base64) in the chat and in the saved threads, which
 * live in localStorage (~5 MB for the whole app): a phone photo (~3.7 MB of base64) filled it and
 * the conversation could not be saved. Attachments are shrunk to what the models use anyway
 * (vision encoders take a few hundred pixels: Gemma 4 turns an image into 256 tokens).
 */
import type { ImageAttachment } from '../../types';
import { logger } from '../logger';

export const MAX_ATTACHMENT_SIDE = 1024;
/** Below this the image is kept as it is (~220 KB of data) */
const KEEP_BELOW_BASE64_CHARS = 300_000;
const JPEG_QUALITY = 0.85;

/** Size that fits `maxSide` keeping the aspect ratio (never enlarges) */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
    const scale = Math.min(1, maxSide / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const stripDataUrl = (data: string) => data.replace(/^data:[^;]+;base64,/, '');

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('The image could not be decoded'));
        img.src = src;
    });
}

/** The attachment as a JPEG of at most MAX_ATTACHMENT_SIDE pixels (unchanged if already small, or on any error) */
export async function shrinkImageAttachment(attachment: ImageAttachment, maxSide = MAX_ATTACHMENT_SIDE): Promise<ImageAttachment> {
    const data = attachment.base64 ? stripDataUrl(attachment.base64) : undefined;
    if (!data || data.length <= KEEP_BELOW_BASE64_CHARS) return attachment;
    try {
        // The WebView applies the EXIF orientation when decoding
        const img = await loadImage(`data:${attachment.mimeType || 'image/jpeg'};base64,${data}`);
        const size = fitWithin(img.naturalWidth, img.naturalHeight, maxSide);
        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return attachment;
        ctx.fillStyle = '#ffffff'; // transparent PNGs get a white background in JPEG
        ctx.fillRect(0, 0, size.width, size.height);
        ctx.drawImage(img, 0, 0, size.width, size.height);
        const base64 = stripDataUrl(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
        logger.log('info', `[Attachment] Image ${img.naturalWidth}x${img.naturalHeight} → ${size.width}x${size.height}, ${Math.round(data.length / 1024)} → ${Math.round(base64.length / 1024)} KB of data`);
        const name = attachment.name ? attachment.name.replace(/\.[^.]+$/, '') + '.jpg' : 'image.jpg';
        return { ...attachment, base64, mimeType: 'image/jpeg', name };
    } catch (e) {
        logger.log('warn', '[Attachment] Could not shrink the image, keeping it as it is', e);
        return attachment;
    }
}
