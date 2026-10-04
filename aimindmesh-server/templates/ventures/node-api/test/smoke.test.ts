import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createServer } from '../src/server';

const server = createServer();
let base = '';

beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

describe('server', () => {
  it('answers /health', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
  });
});
