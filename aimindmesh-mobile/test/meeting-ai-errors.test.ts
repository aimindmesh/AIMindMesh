import { describe, expect, it } from 'vitest';
import { describeAIError } from '../src/services/llm/aiErrors';

/** How the Gemini SDK reports an invalid key: the provider's JSON inside the message. */
const geminiInvalidKey = Object.assign(new Error(JSON.stringify({
    error: { message: JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }) }
})), { status: 400 });

describe('describeAIError', () => {
    it('explains an invalid Gemini key', () => {
        expect(describeAIError(geminiInvalidKey)).toMatch(/key is not valid/);
    });

    it('explains an invalid OpenRouter key', () => {
        expect(describeAIError(new Error('LLM API returned error 401: {"error":{"message":"No auth credentials found","code":401}}'))).toMatch(/key is not valid/);
    });

    it('explains quota, credit, missing model, busy service and no network', () => {
        expect(describeAIError(Object.assign(new Error('{"error":{"status":"RESOURCE_EXHAUSTED"}}'), { status: 429 }))).toMatch(/quota/);
        expect(describeAIError(new Error('LLM API returned error 402: Insufficient credits'))).toMatch(/no credit/);
        expect(describeAIError(Object.assign(new Error('models/x is not found'), { status: 404 }))).toMatch(/model was not found/);
        expect(describeAIError(Object.assign(new Error('The model is overloaded'), { status: 503 }))).toMatch(/busy/);
        expect(describeAIError(new TypeError('Failed to fetch'))).toMatch(/No connection/);
    });

    it('reads the status written by the other providers', () => {
        expect(describeAIError(new Error('Claude API Error: 401 Unauthorized - invalid x-api-key'))).toMatch(/key is not valid/);
        expect(describeAIError(new Error('Perplexity API Error: 429 Too Many Requests - slow down'))).toMatch(/quota/);
        expect(describeAIError(new Error('OpenRouter error (HTTP 402): {"error":{"message":"Insufficient credits"}}'))).toMatch(/no credit/);
        expect(describeAIError(new Error('Server returned 503'))).toMatch(/busy/);
    });

    it('asks for the key when there is none', () => {
        expect(describeAIError(new Error('Claude API key is missing'))).toMatch(/Enter the key/);
        expect(describeAIError(new Error('OpenRouter API key is required. Please configure it in Settings → LLM → OpenRouter.'))).toMatch(/Enter the key/);
        expect(describeAIError(new Error('Gemini API key is not configured. Please set it in Settings.'))).toMatch(/Enter the key/);
    });

    it('shows the provider message of other errors, without the JSON around it', () => {
        expect(describeAIError(new Error(JSON.stringify({ error: { message: 'Something odd happened' } })))).toBe('Something odd happened');
        expect(describeAIError('plain text')).toBe('plain text');
        expect(describeAIError(undefined)).toBe('Unknown error');
    });
});
