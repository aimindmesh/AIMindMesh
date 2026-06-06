import React, { useEffect } from 'react';
import { Personality } from '../../types';
import { PhoneIcon } from '../../constants';
import { triggerHaptic } from '../../services/native';

interface IncomingCallOverlayProps {
    personality: Personality;
    onAccept: () => void;
    onDecline: () => void;
}

const useRingingTone = () => {
    useEffect(() => {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        let oscillator: OscillatorNode | null = null;
        let gainNode: GainNode | null = null;
        let intervalId: number | null = null;

        const playTone = () => {
            if (oscillator) return; // Tone is already playing

            oscillator = audioContext.createOscillator();
            gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(440, audioContext.currentTime); // A4 pitch
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.00001, audioContext.currentTime + 1.5);

            oscillator.start();
            oscillator.stop(audioContext.currentTime + 1.5);
            oscillator.onended = () => {
                oscillator = null;
            };
        };

        const startRinging = () => {
            playTone(); // Play immediately
            intervalId = window.setInterval(playTone, 2000); // Ring every 2 seconds
        };

        const stopRinging = () => {
            if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
            }
            if (oscillator) {
                oscillator.stop();
                oscillator = null;
            }
            audioContext.close();
        };

        startRinging();

        return stopRinging;
    }, []);
};


const IncomingCallOverlay: React.FC<IncomingCallOverlayProps> = ({ personality, onAccept, onDecline }) => {
    useRingingTone();

    const handleAccept = () => {
        triggerHaptic('MEDIUM');
        onAccept();
    };

    const handleDecline = () => {
        triggerHaptic('MEDIUM');
        onDecline();
    };

    return (
        <div className="fixed inset-0 bg-gray-900/90 backdrop-blur-md z-50 flex flex-col items-center justify-around p-8 pt-safe pb-safe text-center animate-fade-in">
            <div>
                <h2 className="text-2xl text-gray-300">Incoming Call...</h2>
                <h1 className="text-5xl font-bold mt-2">{personality.name}</h1>
            </div>

            <div className="flex flex-col items-center">
                <div className="relative w-48 h-48 flex items-center justify-center">
                    <div className="absolute inset-0 bg-companion-primary/30 rounded-full animate-ping"></div>
                    <div className="w-40 h-40 bg-gradient-to-br from-companion-primary to-companion-secondary rounded-full flex items-center justify-center font-bold text-6xl shadow-2xl">
                        {personality.name.charAt(0)}
                    </div>
                </div>
            </div>

            <div className="flex items-center justify-center space-x-16">
                <div className="flex flex-col items-center space-y-2">
                    <button
                        onClick={handleDecline}
                        className="w-20 h-20 bg-red-600 rounded-full flex items-center justify-center shadow-lg hover:bg-red-700 transition-transform transform hover:scale-105"
                        aria-label="Decline call"
                    >
                        <PhoneIcon className="w-10 h-10 rotate-[135deg]" />
                    </button>
                    <span className="text-gray-300">Decline</span>
                </div>
                <div className="flex flex-col items-center space-y-2">
                    <button
                        onClick={handleAccept}
                        className="w-20 h-20 bg-green-600 rounded-full flex items-center justify-center shadow-lg hover:bg-green-700 transition-transform transform hover:scale-105"
                        aria-label="Accept call"
                    >
                        <PhoneIcon className="w-10 h-10" />
                    </button>
                    <span className="text-gray-300">Accept</span>
                </div>
            </div>

            <style>{`
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
      `}</style>
        </div>
    );
};

export default IncomingCallOverlay;
