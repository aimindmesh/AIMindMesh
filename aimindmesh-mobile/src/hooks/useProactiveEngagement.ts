import { useEffect, useRef } from 'react';
import { ProactiveFrequency } from '../types';
import { logger } from '../services/logger';

interface UseProactiveEngagementProps {
  frequency: ProactiveFrequency;
  isIdle: boolean;
  onEngage: () => void;
  idleDetails?: Record<string, boolean>;
  enableDnd?: boolean;
  dndStart?: string;
  dndEnd?: string;
}

const FREQUENCY_MAP = {
  low: { min: 30 * 60 * 1000, max: 60 * 60 * 1000 }, // 30-60 minutes
  medium: { min: 10 * 60 * 1000, max: 30 * 60 * 1000 }, // 10-30 minutes
  high: { min: 2 * 60 * 1000, max: 8 * 60 * 1000 },  // 2-8 minutes
};

const getRandomDelay = (freq: ProactiveFrequency): number => {
  if (freq === 'off' || !FREQUENCY_MAP[freq]) {
    return -1;
  }
  const { min, max } = FREQUENCY_MAP[freq];
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const isDndActive = (start: string, end: string): boolean => {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = start.split(':').map(Number);
  const [endH, endM] = end.split(':').map(Number);

  const startMinutes = (startH || 0) * 60 + (startM || 0);
  const endMinutes = (endH || 0) * 60 + (endM || 0);

  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  } else {
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }
};

export const useProactiveEngagement = ({
  frequency, isIdle, onEngage, idleDetails, enableDnd, dndStart, dndEnd
}: UseProactiveEngagementProps) => {
  const timeoutRef = useRef<number | null>(null);
  const onEngageRef = useRef(onEngage);
  const isIdleRef = useRef(isIdle);
  const enableDndRef = useRef(enableDnd);
  const dndStartRef = useRef(dndStart);
  const dndEndRef = useRef(dndEnd);
  const idleDetailsRef = useRef(idleDetails);

  useEffect(() => {
    onEngageRef.current = onEngage;
  }, [onEngage]);

  useEffect(() => {
    isIdleRef.current = isIdle;
    idleDetailsRef.current = idleDetails;
  }, [isIdle, idleDetails]);

  useEffect(() => {
    enableDndRef.current = enableDnd;
    dndStartRef.current = dndStart;
    dndEndRef.current = dndEnd;
  }, [enableDnd, dndStart, dndEnd]);

  useEffect(() => {
    const clearTimer = () => {
      if (timeoutRef.current) {
        logger.log('debug', 'Clearing proactive engagement timer.');
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    const scheduleNextEvent = () => {
      clearTimer();
      if (frequency === 'off') {
        logger.log('debug', 'Proactive engagement is off.');
        return;
      }

      const delay = getRandomDelay(frequency);
      if (delay > 0) {
        const nextArrival = new Date(Date.now() + delay);
        logger.log('debug', 'Scheduling next proactive engagement', {
          frequency,
          delay: `${(delay / 1000 / 60).toFixed(2)} mins`,
          expectedAt: nextArrival.toLocaleTimeString()
        });

        timeoutRef.current = window.setTimeout(() => {
          // Check for DND if enabled (use refs for current values)
          const currentEnableDnd = enableDndRef.current;
          const currentDndStart = dndStartRef.current;
          const currentDndEnd = dndEndRef.current;
          const currentIsIdle = isIdleRef.current;
          const currentIdleDetails = idleDetailsRef.current;

          const inDndPeriod = currentEnableDnd && currentDndStart && currentDndEnd && isDndActive(currentDndStart, currentDndEnd);

          // Fire engagement if idle and not in DND
          if (currentIsIdle && !inDndPeriod) {
            logger.log('info', 'Firing proactive engagement event.');
            onEngageRef.current();
          } else {
            logger.log('debug', 'Skipping proactive engagement trigger', {
              isIdle: currentIsIdle,
              inDndPeriod,
              enableDnd: currentEnableDnd,
              ...currentIdleDetails
            });
          }
          // Schedule the next one regardless of whether this one fired
          scheduleNextEvent();
        }, delay);
      }
    };

    scheduleNextEvent();

    return clearTimer;
  }, [frequency]);
};
