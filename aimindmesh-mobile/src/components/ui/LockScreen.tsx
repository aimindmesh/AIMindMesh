import React, { useEffect, useState } from 'react';
import { MicrophoneIcon } from '../../constants';
import { AppLock } from '../../services/security/appLock';

/** Covers the app until the user proves it's them (fingerprint, face or screen lock PIN). */
const LockScreen: React.FC<{ onUnlock: () => void }> = ({ onUnlock }) => {
    const [message, setMessage] = useState('');

    const unlock = async () => {
        setMessage('');
        const { success, reason } = await AppLock.authenticate({ title: 'AI Mind Mesh', subtitle: 'Unlock to open the app' })
            .catch(e => ({ success: false, reason: String(e?.message || e) }));
        if (success) onUnlock();
        else if (reason) setMessage(reason);
    };

    useEffect(() => { unlock(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div className="fixed inset-0 z-[10000] bg-background flex flex-col items-center justify-center gap-6 p-8 text-center">
            <div className="p-4 bg-primary/20 rounded-2xl">
                <MicrophoneIcon className="w-10 h-10 text-primary" />
            </div>
            <div className="space-y-1">
                <h1 className="text-lg font-bold text-white">AI Mind Mesh is locked</h1>
                <p className="text-sm text-text-secondary">Recordings in progress keep going.</p>
            </div>
            <button onClick={unlock} className="px-6 py-3 rounded-xl bg-primary text-white font-medium">
                Unlock
            </button>
            {message && <p className="text-xs text-text-secondary max-w-xs">{message}</p>}
        </div>
    );
};

export default LockScreen;
