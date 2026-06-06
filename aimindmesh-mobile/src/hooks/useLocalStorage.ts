import React, { useState, useEffect } from 'react';

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

import { PersistenceService } from '../services/config/persistenceService';

export function useLocalStorage<T>(key: string, initialValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  console.log(`[AI Mind Mesh] useLocalStorage hook initializing for key: "${key}"`);

  const [value, setValue] = useState<T>(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        console.log(`[AI Mind Mesh] Reading localStorage for key: "${key}"`);
        const item = window.localStorage.getItem(key);
        console.log(`[AI Mind Mesh] Raw item for "${key}":`, item);

        if (item) {
          console.log(`[AI Mind Mesh] Parsing item for "${key}"...`);
          const parsed = JSON.parse(item, jsonReviver);
          console.log(`[AI Mind Mesh] Parsed item for "${key}":`, parsed);

          // If the initial value is an object (but not an array), merge it with the parsed value.
          // This ensures that if the app is updated with new properties in the default state,
          // the stored state is gracefully updated without crashing the app.
          if (
            typeof initialValue === 'object' && initialValue !== null && !Array.isArray(initialValue) &&
            typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
          ) {
            console.log(`[AI Mind Mesh] Merging parsed object with initial value for key: "${key}"`);
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
      console.log(`[AI Mind Mesh] No item found for "${key}", using initial value.`);
      return initialValue;
    } catch (error) {
      console.error(`[AI Mind Mesh] CRITICAL ERROR reading/parsing localStorage key "${key}". Falling back to initial value.`, error);
      return initialValue;
    }
  });

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === key && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue, jsonReviver);
          setValue(parsed);
          console.log(`[AI Mind Mesh] useLocalStorage updated state from storage event for key: "${key}"`);
        } catch (error) {
          console.error(`[AI Mind Mesh] Error parsing storage event value for key "${key}"`, error);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [key]);

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        // Storing 'undefined' results in the string "undefined", which is not ideal.
        // It's better to remove the key if the value is undefined.
        // import { PersistenceService } from '../services/config/persistenceService';

        // ... (inside useEffect)

        if (value === undefined) {
          console.log(`[AI Mind Mesh] Value for key "${key}" is undefined, removing from localStorage.`);
          window.localStorage.removeItem(key);
          PersistenceService.removeItem(key).catch((e: unknown) => console.error('Failed to persist removal', e));
        } else {
          console.log(`[AI Mind Mesh] Writing to localStorage for key: "${key}"`);
          const serialized = JSON.stringify(value);
          window.localStorage.setItem(key, serialized);
          // Persist to disk on Desktop
          PersistenceService.saveItem(key, value).catch((e: unknown) => console.error('Failed to persist item', e));
        }
      }
    } catch (error) {
      console.error(`[AI Mind Mesh] Error writing to localStorage key "${key}".`, error);
    }
  }, [key, value]);

  return [value, setValue];
}
