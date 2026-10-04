import React, { useEffect, useState } from 'react';
import { DialogRequest, setDialogListener } from '../../services/ui/dialogs';

/** Shows the dialogs requested through services/ui/dialogs, one at a time. */
const DialogHost: React.FC = () => {
    const [queue, setQueue] = useState<DialogRequest[]>([]);
    const [text, setText] = useState('');
    const current = queue[0];

    useEffect(() => {
        setDialogListener(request => setQueue(q => [...q, request]));
        return () => setDialogListener(null);
    }, []);

    useEffect(() => {
        if (current?.kind === 'text') setText(current.initial);
    }, [current]);

    if (!current) return null;

    const close = (result: any) => {
        (current.resolve as (value: unknown) => void)(result);
        setQueue(q => q.slice(1));
    };
    const cancel = () => close(current.kind === 'confirm' ? false : current.kind === 'alert' ? undefined : null);

    const button = 'px-4 py-2.5 rounded-xl text-sm font-medium transition-colors';

    return (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={cancel}>
            <div
                role="dialog"
                aria-modal="true"
                className="w-full max-w-md bg-surface rounded-2xl shadow-2xl border border-white/10 p-5 space-y-4 animate-fade-in pb-safe sm:pb-5"
                onClick={e => e.stopPropagation()}
            >
                <div className="space-y-1.5">
                    <h3 className="text-base font-semibold text-white">{current.title}</h3>
                    {current.message && <p className="text-sm text-text-secondary whitespace-pre-line">{current.message}</p>}
                </div>

                {current.kind === 'text' && (
                    <form onSubmit={e => { e.preventDefault(); close(text); }}>
                        <input
                            value={text}
                            onChange={e => setText(e.target.value)}
                            placeholder={current.placeholder}
                            autoFocus
                            onFocus={e => e.target.select()}
                            className="w-full px-3 py-2.5 bg-background border border-white/10 rounded-xl text-sm text-white focus:border-primary focus:outline-none"
                        />
                    </form>
                )}

                {current.kind === 'choice' && (
                    <div className="flex flex-col gap-1.5 max-h-[50vh] overflow-y-auto">
                        {current.choices.map(choice => (
                            <button
                                key={choice.id}
                                onClick={() => close(choice.id)}
                                className={`text-left px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 ${choice.danger ? 'text-red-400' : 'text-white'}`}
                            >
                                <span className="text-sm font-medium">{choice.label}</span>
                                {choice.description && <span className="block text-xs text-text-secondary mt-0.5">{choice.description}</span>}
                            </button>
                        ))}
                    </div>
                )}

                <div className="flex justify-end gap-2">
                    {current.kind !== 'alert' && (
                        <button onClick={cancel} className={`${button} text-text-secondary hover:text-white hover:bg-white/5`}>
                            Cancel
                        </button>
                    )}
                    {current.kind === 'confirm' && (
                        <button
                            onClick={() => close(true)}
                            className={`${button} text-white ${current.danger ? 'bg-red-600 hover:bg-red-500' : 'bg-primary hover:bg-primary/90'}`}
                            autoFocus
                        >
                            {current.confirmLabel || 'OK'}
                        </button>
                    )}
                    {current.kind === 'text' && (
                        <button onClick={() => close(text)} className={`${button} text-white bg-primary hover:bg-primary/90`}>
                            {current.confirmLabel || 'Save'}
                        </button>
                    )}
                    {current.kind === 'alert' && (
                        <button onClick={() => close(undefined)} className={`${button} text-white bg-primary hover:bg-primary/90`} autoFocus>
                            OK
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DialogHost;
