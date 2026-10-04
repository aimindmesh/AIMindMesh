import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));

import { fitWithin, shrinkImageAttachment } from '../src/services/image/attachmentImage';
import { createThread, loadThread, saveThreadMessages, withoutInlineImages } from '../src/services/llm/threadManager';
import type { Message } from '../src/types';

const photo = (base64: string) => ({ base64, mimeType: 'image/jpeg', name: 'IMG_0001.jpg' });
const msg = (id: string, extra: Partial<Message> = {}): Message => ({ id, role: 'user', text: 'Cosa vedi?', timestamp: new Date(), ...extra } as Message);

afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
});

describe('image attachments', () => {
    it('fit within 1024 px keeping the aspect ratio, never enlarged', () => {
        expect(fitWithin(4000, 3000, 1024)).toEqual({ width: 1024, height: 768 });
        expect(fitWithin(3000, 4000, 1024)).toEqual({ width: 768, height: 1024 });
        expect(fitWithin(640, 480, 1024)).toEqual({ width: 640, height: 480 });
    });

    it('leave small images as they are', async () => {
        const small = photo('QUJD'.repeat(1000));
        expect(await shrinkImageAttachment(small)).toBe(small);
        const noData = { path: '/x.jpg', mimeType: 'image/jpeg' };
        expect(await shrinkImageAttachment(noData)).toBe(noData);
    });
});

describe('saving conversations with photos', () => {
    it('drops only the image data', () => {
        const thread = createThread([msg('1', { images: [photo('QUJD')] }), msg('2')]);
        const [saved] = withoutInlineImages([thread]);
        expect(saved.messages[0].images).toEqual([{ mimeType: 'image/jpeg', name: 'IMG_0001.jpg' }]);
        expect(saved.messages[1]).toBe(thread.messages[1]);
        expect(thread.messages[0].images?.[0].base64).toBe('QUJD'); // the chat keeps its copy
    });

    it('when the storage is full, keeps the text of the conversation instead of losing it', () => {
        const setItem = localStorage.setItem.bind(localStorage);
        vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, value: string) => {
            if (value.includes('BIGPHOTO')) throw new Error('QuotaExceededError: the value exceeded the quota');
            return setItem(key, value);
        });
        const thread = createThread([]);
        expect(saveThreadMessages(thread.id, [msg('1', { images: [photo('BIGPHOTO')] })])).toBe(true);
        const stored = loadThread(thread.id);
        expect(stored?.messages[0].text).toBe('Cosa vedi?');
        expect(stored?.messages[0].images?.[0].base64).toBeUndefined();
    });
});
