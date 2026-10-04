/**
 * The HTTP status behind an AI error: the Gemini SDK sets it, the other providers write it in
 * the message ("returned error 401", "Claude API Error: 401", "OpenRouter error (HTTP 401)",
 * "Server returned 401", "HTTP 401").
 */
function statusOf(e: any, text: string): number | undefined {
    if (typeof e?.status === 'number') return e.status;
    const match = text.match(/(?:returned(?: error)?|API Error:|HTTP)\s*(\d{3})\b/i) ?? text.match(/"code"\s*:\s*(\d{3})/);
    return match ? Number(match[1]) : undefined;
}

/** The innermost "message" of an error that wraps the provider's JSON answer. */
function innermostMessage(text: string): string {
    let message = text;
    for (let depth = 0; depth < 3; depth++) {
        try {
            const parsed = JSON.parse(message.slice(message.indexOf('{')));
            const inner = parsed?.error?.message ?? parsed?.message;
            if (typeof inner !== 'string') break;
            message = inner;
        } catch {
            break;
        }
    }
    return message.trim();
}

/** Says in plain words why an AI request failed and what to do about it. */
export function describeAIError(e: unknown): string {
    const err = e as any;
    const text = String(err?.message ?? err ?? '');
    const status = statusOf(err, text);
    const has = (pattern: RegExp) => pattern.test(text);

    if (has(/API key (is not configured|is missing|is required)/i)) {
        return 'Enter the key in Settings → LLM first.';
    }
    if (has(/API key not valid|API_KEY_INVALID|invalid api key|no auth credentials|incorrect api key/i) || status === 401) {
        return 'The key is not valid: copy it again from the provider site, whole and without spaces.';
    }
    if (status === 402 || has(/insufficient credits|insufficient_quota/i)) {
        return 'The account has no credit left: add credit on the provider site.';
    }
    if (status === 429 || has(/RESOURCE_EXHAUSTED|quota|rate limit/i)) {
        return 'Too many requests or free quota used up: wait a minute and try again.';
    }
    if (status === 403 || has(/PERMISSION_DENIED/)) {
        return 'This key cannot use the service: create a new key and try again.';
    }
    if (status === 404 || has(/NOT_FOUND|model.*not found/i)) {
        return 'The model was not found: choose another model in Settings → LLM.';
    }
    if ((status !== undefined && status >= 500) || has(/UNAVAILABLE|overloaded/i)) {
        return 'The AI service is busy right now: try again in a few minutes.';
    }
    if (has(/failed to fetch|fetch failed|networkerror|network request failed|load failed/i)) {
        return 'No connection to the AI service: check the internet connection.';
    }
    return innermostMessage(text).slice(0, 200) || 'Unknown error';
}
