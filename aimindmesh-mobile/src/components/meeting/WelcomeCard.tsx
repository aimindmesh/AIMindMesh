import React, { useEffect, useState } from 'react';
import { downloadWhisperModel as downloadModel, whisperModelExists as isModelInstalled, WHISPER_MODELS } from '../../services/stt/whisperModelDownloader';
import { logger } from '../../services/logger';
import { FlagIcon, MicrophoneIcon, SparklesIcon } from '../../constants';

const RECOMMENDED = WHISPER_MODELS.find(m => m.recommended)!;
const DISMISSED_KEY = 'meeting-welcome-dismissed';

export function isWelcomeDismissed(): boolean {
    try {
        return localStorage.getItem(DISMISSED_KEY) === 'true';
    } catch {
        return true;
    }
}

interface WelcomeCardProps {
    onOpenAISettings: () => void;
    onDismiss: () => void;
    isAIConfigured: boolean;
}

/** First-use guide: what the app does, the recommended model for Italian, the optional AI. */
const WelcomeCard: React.FC<WelcomeCardProps> = ({ onOpenAISettings, onDismiss, isAIConfigured }) => {
    const [installed, setInstalled] = useState<boolean | null>(null);
    const [progress, setProgress] = useState<number | null>(null);
    const [error, setError] = useState('');

    useEffect(() => {
        isModelInstalled(RECOMMENDED.id).then(setInstalled).catch(() => setInstalled(false));
    }, []);

    const download = async () => {
        setError('');
        setProgress(0);
        try {
            await downloadModel(RECOMMENDED, p => setProgress(p.percentage));
            setInstalled(true);
        } catch (e: any) {
            logger.log('error', 'Recommended model download failed', e);
            setError(`Download failed: ${e?.message || String(e)}`);
        } finally {
            setProgress(null);
        }
    };

    const dismiss = () => {
        try { localStorage.setItem(DISMISSED_KEY, 'true'); } catch { /* shown again next time */ }
        onDismiss();
    };

    const step = 'flex gap-3 items-start';
    const number = 'w-6 h-6 shrink-0 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center mt-0.5';

    return (
        <div className="flex-1 overflow-y-auto p-4">
            <div className="max-w-md mx-auto space-y-5 p-5 rounded-2xl bg-surface/60 border border-white/10">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/20 rounded-xl"><MicrophoneIcon className="w-6 h-6 text-primary" /></div>
                    <h2 className="text-lg font-bold text-white">Welcome to Meeting Assistant</h2>
                </div>

                <div className={step}>
                    <span className={number}>1</span>
                    <p className="text-sm text-text-primary">
                        Press the red button to record. The text appears while people talk; when you stop, the phone writes it again more accurately and works out who said what.
                    </p>
                </div>

                <div className={step}>
                    <span className={number}>2</span>
                    <div className="space-y-2 text-sm text-text-primary">
                        <p>{`For Italian, download the recommended transcription model (${RECOMMENDED.size}). Better on Wi-Fi.`}</p>
                        {installed ? (
                            <p className="text-green-400 text-xs font-medium">✓ Recommended model installed</p>
                        ) : progress !== null ? (
                            <div className="space-y-1">
                                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                                    <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                                </div>
                                <p className="text-xs text-text-secondary">{`Downloading… ${Math.round(progress)}%`}</p>
                            </div>
                        ) : installed === false ? (
                            <button onClick={download} className="px-3 py-2 rounded-lg bg-primary text-white text-xs font-medium">
                                Download the recommended model
                            </button>
                        ) : null}
                        {error && <p className="text-xs text-red-400">{error}</p>}
                    </div>
                </div>

                <div className={step}>
                    <span className={number}>3</span>
                    <div className="space-y-2 text-sm text-text-primary">
                        <p className="flex gap-1.5">
                            <FlagIcon className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
                            During the meeting tap the flag to mark an important moment, also from the notification with the phone locked.
                        </p>
                    </div>
                </div>

                <div className={step}>
                    <span className={number}>4</span>
                    <div className="space-y-2 text-sm text-text-primary">
                        <p className="flex gap-1.5">
                            <SparklesIcon className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
                            Optional: connect the AI to get a summary, decisions and to-dos, and to ask questions about the meeting. You need a free key, it takes two minutes.
                        </p>
                        {isAIConfigured ? (
                            <p className="text-green-400 text-xs font-medium">✓ AI connected</p>
                        ) : (
                            <button onClick={onOpenAISettings} className="px-3 py-2 rounded-lg bg-surface border border-white/10 text-white text-xs font-medium">
                                Connect the AI
                            </button>
                        )}
                    </div>
                </div>

                <p className="text-xs text-text-secondary">
                    Recordings and transcripts stay on this phone. You find all meetings under the clock icon, and a guide under the "?" icon.
                </p>

                <button onClick={dismiss} className="w-full py-2.5 rounded-xl bg-primary text-white text-sm font-medium">
                    Got it
                </button>
            </div>
        </div>
    );
};

export default WelcomeCard;
