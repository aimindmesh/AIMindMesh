import React, { useEffect, useState } from 'react';

interface LevelMeterProps {
    /** Subscribes to the microphone level (0-1); returns the unsubscribe function. */
    subscribe: (listener: (level: number) => void) => () => void;
    isPaused: boolean;
    bars?: number;
}

/** Bars moving with the microphone level. Owns the level, so only it re-renders 10 times a second. */
const LevelMeter: React.FC<LevelMeterProps> = ({ subscribe, isPaused, bars = 30 }) => {
    const [level, setLevel] = useState(0);
    useEffect(() => subscribe(setLevel), [subscribe]);

    return (
        <div className="h-10 mb-4 flex items-center justify-center gap-1">
            {Array.from({ length: bars }).map((_, i) => (
                <div
                    key={i}
                    className="w-1 bg-primary rounded-full transition-all duration-75"
                    style={{
                        height: !isPaused ? `${Math.max(10, Math.random() * level * 100)}%` : '10%',
                        opacity: !isPaused ? 1 : 0.3
                    }}
                />
            ))}
        </div>
    );
};

export default LevelMeter;
