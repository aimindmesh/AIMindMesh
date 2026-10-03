import { describe, expect, it, vi } from 'vitest';
import {
    cleanRewrittenPrompt, imageFromToolData, resolveToolSourceImage, rewriteImagePrompt,
} from '../src/services/image/imagePrompt';
import type { Message } from '../src/types';

const msg = (id: string, images?: Message['images']): Message =>
    ({ id, role: 'user', text: id, timestamp: new Date(), images }) as Message;

describe('chat prompts for Stable Diffusion', () => {
    it('keeps only the prompt from the model answer', () => {
        expect(cleanRewrittenPrompt('<think>the user wants a cat</think>\n\nPrompt: "a ginger cat on a sofa, soft light"'))
            .toBe('a ginger cat on a sofa, soft light');
        expect(cleanRewrittenPrompt('  \n“a red car”\nThis prompt describes…')).toBe('a red car');
        expect(cleanRewrittenPrompt('<think>still thinking')).toBe('');
    });

    it('asks the model for an English description and uses its answer', async () => {
        const complete = vi.fn(async (_instruction: string) => 'a lighthouse on a cliff at sunset, oil painting');
        expect(await rewriteImagePrompt('un faro su una scogliera al tramonto', 'generate', complete))
            .toBe('a lighthouse on a cliff at sunset, oil painting');
        expect(complete.mock.calls[0][0]).toMatch(/translate/i);
        expect(complete.mock.calls[0][0]).toContain('un faro su una scogliera al tramonto');

        await rewriteImagePrompt('rendi il cielo rosso', 'edit', complete);
        expect(complete.mock.calls[1][0]).toMatch(/cannot follow instructions/);
    });

    it('falls back to the original text when the model fails, answers nothing or is too slow', async () => {
        expect(await rewriteImagePrompt('a cat', 'generate', async () => { throw new Error('offline'); })).toBe('a cat');
        expect(await rewriteImagePrompt('a cat', 'generate', async () => '')).toBe('a cat');
        vi.useFakeTimers();
        const slow = rewriteImagePrompt('a cat', 'generate', () => new Promise(() => {}), 1000);
        await vi.advanceTimersByTimeAsync(1000);
        expect(await slow).toBe('a cat');
        vi.useRealTimers();
    });
});

describe('images in tool calls', () => {
    const photo = { name: 'p.jpg', base64: 'AAAA', mimeType: 'image/jpeg' };
    const earlier = { name: 'e.png', base64: 'BBBB', mimeType: 'image/png' };

    it('passes real image data through', () => {
        expect(resolveToolSourceImage('data:image/png;base64,QQ==', [])).toEqual({ source: 'data:image/png;base64,QQ==' });
        expect(resolveToolSourceImage('/storage/emulated/0/x.jpg', [])).toEqual({ source: '/storage/emulated/0/x.jpg' });
        expect(resolveToolSourceImage(undefined, [])).toEqual({});
    });

    it('turns "last" (or a description) into the newest image of the run or of the chat', () => {
        const history = [msg('a', [earlier]), msg('b'), msg('c', [photo])];
        expect(resolveToolSourceImage('last', history).source).toBe('data:image/jpeg;base64,AAAA');
        expect(resolveToolSourceImage("the user's photo", history).source).toBe('data:image/jpeg;base64,AAAA');
        const generated = { name: 'g.png', base64: 'CCCC', mimeType: 'image/png' };
        expect(resolveToolSourceImage('last', history, [generated]).source).toBe('data:image/png;base64,CCCC');
    });

    it('reports when there is nothing to edit', () => {
        expect(resolveToolSourceImage('last', [msg('a')]).error).toMatch(/no image/i);
    });

    it('turns a generated picture into a chat attachment', () => {
        expect(imageFromToolData({ base64Image: 'data:image/jpeg;base64,ZZZZ' }))
            .toMatchObject({ base64: 'ZZZZ', mimeType: 'image/jpeg' });
        expect(imageFromToolData({ base64Image: 'data:image/png;base64,YYYY' })?.name).toMatch(/\.png$/);
        expect(imageFromToolData({ message: 'no picture' })).toBeNull();
        expect(imageFromToolData(undefined)).toBeNull();
    });
});
