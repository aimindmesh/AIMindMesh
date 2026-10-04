import { afterEach, describe, expect, it } from 'vitest';
import { askChoice, askConfirm, askText, DialogRequest, setDialogListener, showAlert } from '../src/services/ui/dialogs';

afterEach(() => setDialogListener(null));

describe('in-app dialogs', () => {
    it('delivers requests made before the host mounts, in order', async () => {
        const confirmed = askConfirm({ title: 'Delete?' });
        const named = askText({ title: 'Name', initial: 'Anna' });
        const seen: DialogRequest[] = [];
        setDialogListener(r => seen.push(r));
        expect(seen.map(r => r.kind)).toEqual(['confirm', 'text']);
        (seen[0] as Extract<DialogRequest, { kind: 'confirm' }>).resolve(true);
        (seen[1] as Extract<DialogRequest, { kind: 'text' }>).resolve('Bea');
        await expect(confirmed).resolves.toBe(true);
        await expect(named).resolves.toBe('Bea');
    });

    it('resolves choices and alerts through the mounted host', async () => {
        setDialogListener(r => {
            if (r.kind === 'choice') r.resolve(r.choices[1].id);
            if (r.kind === 'alert') r.resolve();
        });
        await expect(askChoice({ title: 'Who?', choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] })).resolves.toBe('b');
        await expect(showAlert({ title: 'Done' })).resolves.toBeUndefined();
    });

    it('a text dialog starts empty unless given an initial value', () => {
        const seen: DialogRequest[] = [];
        setDialogListener(r => seen.push(r));
        void askText({ title: 'Title' });
        expect(seen[0]).toMatchObject({ kind: 'text', initial: '' });
    });
});
