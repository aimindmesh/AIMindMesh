import React, { useState, useEffect, useRef } from 'react';

// Regex to detect ISO 8601 date strings
const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

function jsonReviver(_key: string, value: any) {
  // If the value is a string and matches the ISO date format, convert it back to a Date object.
  if (typeof value === 'string' && isoDateRegex.test(value)) {
    return new Date(value);
  }
  // Otherwise, return the value as is.
  return value;
}

import { getSecret, storeSetting } from '../services/security/secretStore';
import { mergeSecrets } from '../services/security/secretFields';
import { createWriteThrottle } from './writeThrottle';

/** Minimum time between two writes of the same key (later changes are coalesced) */
const WRITE_INTERVAL_MS = 1000;

/**
 * State persisted in localStorage (and app-settings.json on desktop). API keys inside the
 * value are kept in the secret store instead (see secretStore.ts): merged in when reading,
 * stripped when writing, so callers always see the full value.
 */
export function useLocalStorage<T>(key: string, initialValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => mergeSecrets(key, readStored(), getSecret));

  function readStored(): T {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const item = window.localStorage.getItem(key);
        // Values are never logged: several keys hold API keys and credentials

        if (item) {
          const parsed = JSON.parse(item, jsonReviver);

          // If the initial value is an object (but not an array), merge it with the parsed value.
          // This ensures that if the app is updated with new properties in the default state,
          // the stored state is gracefully updated without crashing the app.
          if (
            typeof initialValue === 'object' && initialValue !== null && !Array.isArray(initialValue) &&
            typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
          ) {
            return { ...initialValue, ...parsed };
          }

          // If the initial value is an array but the stored value is not, discard the stored value.
          if (Array.isArray(initialValue) && !Array.isArray(parsed)) {
            console.warn(`[AI Mind Mesh] Stored value for key "${key}" is not an array, falling back to initial value.`);
            return initialValue;
          }

          // For primitives, or if parsed data is null/undefined.
          return parsed ?? initialValue;
        }
      }
      return initialValue;
    } catch (error) {
      console.error(`[AI Mind Mesh] CRITICAL ERROR reading/parsing localStorage key "${key}". Falling back to initial value.`, error);
      return initialValue;
    }
  }

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === key && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue, jsonReviver);
          setValue(mergeSecrets(key, parsed, getSecret));
          console.log(`[AI Mind Mesh] useLocalStorage updated state from storage event for key: "${key}"`);
        } catch (error) {
          console.error(`[AI Mind Mesh] Error parsing storage event value for key "${key}"`, error);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [key]);

  // Writes are throttled per key: a streaming chat would otherwise serialize the whole
  // history to storage on every update
  const keyRef = useRef(key);
  keyRef.current = key;
  const writerRef = useRef<ReturnType<typeof createWriteThrottle<T>> | null>(null);
  if (!writerRef.current) {
    writerRef.current = createWriteThrottle<T>(next => {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          // undefined removes the key; secrets go to the secret store; desktop also mirrors to disk
          storeSetting(keyRef.current, next);
        }
      } catch (error) {
        console.error(`[AI Mind Mesh] Error writing to localStorage key "${keyRef.current}".`, error);
      }
    }, WRITE_INTERVAL_MS);
  }

  useEffect(() => {
    writerRef.current!.push(value);
  }, [key, value]);

  // A coalesced write is not left pending when the app goes to background or the owner unmounts
  useEffect(() => {
    const writer = writerRef.current!;
    const flushWhenHidden = () => { if (document.visibilityState === 'hidden') writer.flush(); };
    document.addEventListener('visibilitychange', flushWhenHidden);
    window.addEventListener('pagehide', writer.flush);
    return () => {
      document.removeEventListener('visibilitychange', flushWhenHidden);
      window.removeEventListener('pagehide', writer.flush);
      writer.flush();
    };
  }, []);

  return [value, setValue];
}
