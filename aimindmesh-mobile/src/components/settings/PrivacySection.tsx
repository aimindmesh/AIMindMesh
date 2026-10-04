import React, { useState } from 'react';
import { AppLock, isAppLockEnabled, setAppLockEnabled } from '../../services/security/appLock';
import { showAlert } from '../../services/ui/dialogs';
import { Capacitor } from '@capacitor/core';

/** App lock, and what the app does with the data. */
export const PrivacySection: React.FC = () => {
    const [lock, setLock] = useState(isAppLockEnabled);

    const toggleLock = async (enabled: boolean) => {
        if (enabled) {
            const { available } = await AppLock.isAvailable().catch(() => ({ available: false }));
            if (!available) {
                await showAlert({
                    title: 'No screen lock on this phone',
                    message: 'Set a PIN, pattern or password in the Android settings first: the app uses it to verify it\'s you.'
                });
                return;
            }
            const { success } = await AppLock.authenticate({ title: 'AI Mind Mesh', subtitle: 'Confirm to turn on the app lock' });
            if (!success) return;
        }
        setAppLockEnabled(enabled);
        setLock(enabled);
    };

    return (
        <div className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-3">
            <h4 className="text-sm font-semibold text-white">Privacy</h4>
            <label className="flex items-center justify-between gap-3 cursor-pointer">
                <span className="text-sm text-white">
                    Lock with fingerprint or PIN
                    <span className="block text-xs text-text-secondary mt-0.5">
                        Asked when the app opens and after a minute in the background. The app's content is also hidden from screenshots and the recent apps view. Recordings keep going while locked.
                    </span>
                </span>
                <input type="checkbox" checked={lock} onChange={e => toggleLock(e.target.checked)} className="w-5 h-5 accent-primary shrink-0" />
            </label>
            <ul className="text-xs text-text-secondary space-y-1 list-disc pl-4">
                <li>Meeting recordings and voices stay on this phone; transcripts and notes reach your AIMindMesh server only when sync is on. Transcription and speaker recognition run on the phone.</li>
                <li>A meeting goes to your AI provider only when you ask for notes or questions, or turn on automatic notes.</li>
                {Capacitor.isNativePlatform() && <li>API keys are encrypted with a key kept in the phone's secure hardware.</li>}
            </ul>
        </div>
    );
};
