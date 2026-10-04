import { describe, expect, it } from 'vitest';
import { name } from '../src/index';

describe('package', () => {
  it('loads', () => {
    expect(name).toBe('__NAME__');
  });
});
