import { beforeEach } from 'vitest';

/** In-memory localStorage (the app keeps settings and chat threads there). */
class MemoryStorage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.has(key) ? this.data.get(key)! : null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
if (typeof (globalThis as any).window === 'undefined') {
  // Modules that only touch window.localStorage / window.addEventListener
  (globalThis as any).window = Object.assign(new EventTarget(), { localStorage: storage });
}

beforeEach(() => storage.clear());
