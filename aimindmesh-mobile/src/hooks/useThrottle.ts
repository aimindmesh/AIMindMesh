import { useEffect, useRef, useCallback } from 'react';

/**
 * Hook for throttling updates during streaming to reduce re-renders
 * @param callback Function to call with throttled value
 * @param delay Minimum delay between updates in milliseconds
 * @returns Function to call with values that will be throttled
 */
export function useThrottle<T>(callback: (value: T) => void, delay: number) {
    const lastRun = useRef(Date.now());
    const timeoutRef = useRef<NodeJS.Timeout>();

    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    return useCallback((value: T) => {
        const now = Date.now();
        const timeSinceLastRun = now - lastRun.current;

        if (timeSinceLastRun >= delay) {
            // Enough time has passed, update immediately
            lastRun.current = now;
            callback(value);
        } else {
            // Schedule update for later
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
            timeoutRef.current = setTimeout(() => {
                lastRun.current = Date.now();
                callback(value);
            }, delay - timeSinceLastRun);
        }
    }, [callback, delay]);
}
