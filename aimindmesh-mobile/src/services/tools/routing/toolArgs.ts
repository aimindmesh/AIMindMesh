/**
 * Arguments of a tool call checked against the tool's schema before it runs, and repaired when
 * the intent is clear: numbers written as text, times as "7" or "7.30", dates as the words the
 * user said ("domani", "venerdì": dateResolver). What cannot be repaired becomes an error the
 * model gets back once (agentRunner), in its language.
 */
import { getToolByName } from '../../toolDefinitions';
import { resolveWhen } from '../../memory/facts/dateResolver';
import { localDay } from '../../memory/facts/consolidationPrompt';

export interface ArgsCheck {
    args: Record<string, unknown>;
    /** What is wrong, for the model (English, short), or null */
    error: string | null;
}

const isDateKey = (key: string) => /(^|_)date$/.test(key);
const isTimeKey = (key: string) => key === 'time' || /(^|_)time$/.test(key);

function asTime(value: unknown): string | null {
    // "15", "7.30", "alle 15", "ore 9:45", "at 7" (the hour may come with the user's words)
    const m = /(?:^|\D)(\d{1,2})(?:[:.](\d{2}))?(?!\d)/.exec(String(value).replace(/\b\d{4}-\d{2}-\d{2}\b/, ''));
    if (!m) return null;
    const h = Number(m[1]), min = Number(m[2] ?? 0);
    return h < 24 && min < 60 ? `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` : null;
}

function asDate(value: unknown, now: number): string | null {
    const text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const day = resolveWhen(text, now);
    return day === undefined ? null : localDay(day);
}

export function checkToolArgs(name: string, raw: Record<string, unknown> | undefined, now: number = Date.now()): ArgsCheck {
    const tool = getToolByName(name);
    const args: Record<string, unknown> = { ...(raw ?? {}) };
    if (!tool) return { args, error: `unknown tool ${name}` };
    const problems: string[] = [];
    const properties = tool.parameters.properties;
    for (const [key, spec] of Object.entries(properties)) {
        const value = args[key];
        if (value === undefined || value === null || value === '') continue;
        const type = String(spec.type).toUpperCase();
        if (type === 'NUMBER' || type === 'INTEGER') {
            const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
            if (Number.isFinite(n)) args[key] = n;
            else problems.push(`${key} must be a number`);
        } else if (type === 'BOOLEAN') {
            if (typeof value !== 'boolean') args[key] = /^(true|sì|si|yes|1)$/i.test(String(value));
        } else if (type === 'STRING') {
            let text = typeof value === 'string' ? value.trim() : JSON.stringify(value);
            if (isDateKey(key)) {
                const date = asDate(text, now);
                if (date) text = date; else problems.push(`${key} must be a date YYYY-MM-DD`);
            } else if (isTimeKey(key)) {
                const time = asTime(text);
                if (time) text = time; else problems.push(`${key} must be a time HH:MM`);
            }
            if (spec.enum && !spec.enum.includes(text)) problems.push(`${key} must be one of ${spec.enum.join(', ')}`);
            args[key] = text;
        }
    }
    for (const key of tool.parameters.required ?? []) {
        if (args[key] === undefined || args[key] === null || args[key] === '') problems.push(`${key} is required`);
    }
    return { args, error: problems.length > 0 ? problems.join('; ') : null };
}
