import React, { useEffect, useState } from 'react';
import { TrashIcon, PencilIcon } from '../../constants';
import { OWNER_VOICE_ID, VoiceProfile } from '../../services/speaker/voiceProfiles';
import { deleteVoiceProfile, listVoiceProfiles, saveVoiceProfile } from '../../services/speaker/voiceStorage';
import { askConfirm, askText } from '../../services/ui/dialogs';
import { logger } from '../../services/logger';

/** The voices the app recognizes in new meetings, with rename and delete. */
export const KnownVoicesSection: React.FC = () => {
    const [voices, setVoices] = useState<VoiceProfile[] | null>(null);

    const reload = () => listVoiceProfiles()
        .then(setVoices)
        .catch(e => {
            logger.log('error', 'Could not load known voices', e);
            setVoices([]);
        });

    useEffect(() => { reload(); }, []);

    const rename = async (voice: VoiceProfile) => {
        const name = await askText({ title: 'Name of this voice', initial: voice.name });
        if (name && name.trim() && name.trim() !== voice.name) {
            await saveVoiceProfile({ ...voice, name: name.trim() });
            reload();
        }
    };

    const remove = async (voice: VoiceProfile) => {
        const ok = await askConfirm({
            title: `Forget the voice of ${voice.name}?`,
            message: 'New meetings won\'t name this person automatically. Meetings already named keep their names.',
            confirmLabel: 'Forget',
            danger: true
        });
        if (ok) {
            await deleteVoiceProfile(voice.id);
            reload();
        }
    };

    return (
        <div className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-3">
            <div>
                <h4 className="text-sm font-semibold text-white">Known voices</h4>
                <p className="text-xs text-text-secondary mt-0.5">
                    When you name a speaker, the app remembers their voice and names them in the next meetings. Voices are stored only on this phone.
                </p>
            </div>
            {voices === null ? null : voices.length === 0 ? (
                <p className="text-xs text-text-secondary italic">No voices yet: tap a speaker's name in a transcript to name them.</p>
            ) : (
                <ul className="divide-y divide-white/5">
                    {voices.map(v => (
                        <li key={v.id} className="flex items-center gap-2 py-2">
                            <div className="flex-1 min-w-0">
                                <p className="text-sm text-white truncate">
                                    {v.name}
                                    {v.id === OWNER_VOICE_ID && (
                                        <span className="ml-2 text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded uppercase tracking-wide">You</span>
                                    )}
                                </p>
                                <p className="text-[11px] text-text-secondary">
                                    {(v.meetings === 1 ? `Learned from ${v.meetings} meeting` : `Learned from ${v.meetings} meetings`)} · {new Date(v.updatedAt).toLocaleDateString()}
                                </p>
                            </div>
                            <button onClick={() => rename(v)} className="p-2 text-text-secondary hover:text-white" aria-label={`Rename ${v.name}`}>
                                <PencilIcon className="w-4 h-4" />
                            </button>
                            <button onClick={() => remove(v)} className="p-2 text-text-secondary hover:text-red-400" aria-label={`Forget ${v.name}`}>
                                <TrashIcon className="w-4 h-4" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};
