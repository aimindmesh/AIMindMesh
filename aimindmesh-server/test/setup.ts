import { beforeEach, vi } from 'vitest';
import axios from 'axios';

// The Logger writes to SQLite: silence it everywhere
vi.mock('../src/utils/Logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// No real network: any outgoing HTTP call fails loudly unless a test stubs it
axios.defaults.adapter = async (request) => {
  throw new Error(`Network disabled in tests: ${request.method?.toUpperCase()} ${request.url}`);
};

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network disabled in tests'));
});
