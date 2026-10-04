/**
 * In-app dialogs with a promise API, usable from components and hooks alike. They replace the
 * WebView's prompt()/confirm()/alert(), which look out of place and block the page.
 * Rendered by <DialogHost />.
 */

export interface DialogChoice {
    id: string;
    label: string;
    description?: string;
    /** Shown in the danger color. */
    danger?: boolean;
}

export type DialogRequest =
    | { kind: 'confirm'; title: string; message?: string; confirmLabel?: string; danger?: boolean; resolve: (ok: boolean) => void }
    | { kind: 'text'; title: string; message?: string; initial: string; placeholder?: string; confirmLabel?: string; resolve: (value: string | null) => void }
    | { kind: 'choice'; title: string; message?: string; choices: DialogChoice[]; resolve: (id: string | null) => void }
    | { kind: 'alert'; title: string; message?: string; resolve: () => void };

type Listener = (request: DialogRequest) => void;

let listener: Listener | null = null;
const waiting: DialogRequest[] = [];

/** Called by DialogHost; requests made before it mounts are delivered then. */
export function setDialogListener(l: Listener | null) {
    listener = l;
    while (listener && waiting.length) listener(waiting.shift()!);
}

function open(request: DialogRequest) {
    if (listener) listener(request);
    else waiting.push(request);
}

/** Resolves true when the user confirms. */
export function askConfirm(options: { title: string; message?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
    return new Promise(resolve => open({ kind: 'confirm', ...options, resolve }));
}

/** Resolves the text entered, or null if cancelled. */
export function askText(options: { title: string; message?: string; initial?: string; placeholder?: string; confirmLabel?: string }): Promise<string | null> {
    return new Promise(resolve => open({ kind: 'text', initial: '', ...options, resolve }));
}

/** Resolves the id of the chosen option, or null if cancelled. */
export function askChoice(options: { title: string; message?: string; choices: DialogChoice[] }): Promise<string | null> {
    return new Promise(resolve => open({ kind: 'choice', ...options, resolve }));
}

export function showAlert(options: { title: string; message?: string }): Promise<void> {
    return new Promise(resolve => open({ kind: 'alert', ...options, resolve }));
}
