import { describe, expect, it } from 'vitest';
import { extractSecrets, mergeSecrets, stripSecrets } from '../src/services/security/secretFields';

describe('secret fields', () => {
  it('strips and merges nested secrets without touching other fields', () => {
    const settings = { enabled: true, serverUrl: 'http://s', apiKey: 'K' };
    expect(extractSecrets('aimindmesh-server-settings', settings)).toEqual({ 'aimindmesh-server-settings.apiKey': 'K' });
    const stripped = stripSecrets('aimindmesh-server-settings', settings);
    expect(stripped).toEqual({ enabled: true, serverUrl: 'http://s' });
    expect(mergeSecrets('aimindmesh-server-settings', stripped, () => 'K')).toEqual(settings);
  });

  it('removes whole-key secrets and keeps values the store does not hold', () => {
    expect(stripSecrets('gemini-api-key', 'AIza')).toBeUndefined();
    expect(mergeSecrets('gemini-api-key', 'plain', () => undefined)).toBe('plain');
    expect(mergeSecrets('gemini-api-key', '', () => '')).toBe('');
  });
});
