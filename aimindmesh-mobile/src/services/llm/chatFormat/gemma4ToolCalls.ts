/**
 * Gemma 4 native tool calls, as its chat template writes them and the model emits them:
 *   <|tool_call>call:search_web{query:<|"|>meteo Varese<|"|>,days:2}<tool_call|>
 * Strings are wrapped in <|"|>, keys are bare, values may be numbers, booleans, objects and
 * arrays. The bare form (call:name{…} without the special tokens) is accepted too, in case an
 * engine drops special tokens when detokenizing.
 */

export interface NativeToolCall { name: string; args: Record<string, unknown> }

const QUOTE = '<|"|>';
const CALL = /(?:<\|tool_call>\s*)?call:([A-Za-z_][\w.-]*)\s*\{/g;

class Reader {
    constructor(private readonly s: string, public i: number) {}
    private ws() { while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++; }
    peek(text: string) { this.ws(); return this.s.startsWith(text, this.i); }
    take(text: string) { if (!this.peek(text)) throw new Error(`expected ${text} at ${this.i}`); this.i += text.length; }

    value(): unknown {
        this.ws();
        if (this.s.startsWith(QUOTE, this.i)) {
            const end = this.s.indexOf(QUOTE, this.i + QUOTE.length);
            if (end < 0) throw new Error('unterminated string');
            const text = this.s.slice(this.i + QUOTE.length, end);
            this.i = end + QUOTE.length;
            return text;
        }
        const c = this.s[this.i];
        if (c === '{') return this.object();
        if (c === '[') return this.array();
        if (c === '"') { // a model writing JSON strings inside the native call
            const m = /^"((?:[^"\\]|\\.)*)"/.exec(this.s.slice(this.i));
            if (!m) throw new Error('unterminated string');
            this.i += m[0].length;
            return JSON.parse(m[0]);
        }
        const m = /^[^,}\]]*/.exec(this.s.slice(this.i))!;
        this.i += m[0].length;
        const raw = m[0].trim();
        if (raw === 'true') return true;
        if (raw === 'false') return false;
        if (raw === 'null') return null;
        if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(raw)) return Number(raw);
        return raw;
    }

    object(): Record<string, unknown> {
        this.take('{');
        const out: Record<string, unknown> = {};
        if (this.peek('}')) { this.i++; return out; }
        for (;;) {
            this.ws();
            let key: string;
            if (this.s.startsWith(QUOTE, this.i)) key = String(this.value());
            else if (this.s[this.i] === '"') key = String(this.value());
            else {
                const m = /^[^:,}]+/.exec(this.s.slice(this.i));
                if (!m) throw new Error(`key expected at ${this.i}`);
                key = m[0].trim();
                this.i += m[0].length;
            }
            this.take(':');
            out[key] = this.value();
            if (this.peek(',')) { this.i++; continue; }
            this.take('}');
            return out;
        }
    }

    array(): unknown[] {
        this.take('[');
        const out: unknown[] = [];
        if (this.peek(']')) { this.i++; return out; }
        for (;;) {
            out.push(this.value());
            if (this.peek(',')) { this.i++; continue; }
            this.take(']');
            return out;
        }
    }
}

/**
 * The calls in a model output, and the text around them (what the model said besides calling).
 * A call cut off by the token limit is dropped.
 */
export function parseGemma4ToolCalls(text: string): { calls: NativeToolCall[]; text: string } {
    const calls: NativeToolCall[] = [];
    let rest = '';
    let last = 0;
    CALL.lastIndex = 0;
    for (let m = CALL.exec(text); m; m = CALL.exec(text)) {
        const reader = new Reader(text, m.index + m[0].length - 1);
        try {
            const args = reader.object();
            calls.push({ name: m[1], args });
            rest += text.slice(last, m.index);
            let end = reader.i;
            const close = /^\s*<tool_call\|>/.exec(text.slice(end));
            if (close) end += close[0].length;
            last = end;
            CALL.lastIndex = end;
        } catch {
            // Truncated or malformed: leave the text as it is
        }
    }
    rest += text.slice(last);
    return { calls, text: rest.replace(/<\|tool_call>|<tool_call\|>/g, '').trim() };
}

/** A tool call as the Gemma 4 template renders it (for history turns and few-shot examples) */
export function formatGemma4ToolCall(call: NativeToolCall): string {
    const arg = (v: unknown): string => {
        if (typeof v === 'string') return `${QUOTE}${v}${QUOTE}`;
        if (Array.isArray(v)) return `[${v.map(arg).join(',')}]`;
        if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${k}:${arg((v as Record<string, unknown>)[k])}`).join(',')}}`;
        return String(v);
    };
    return `<|tool_call>call:${call.name}{${Object.keys(call.args).sort().map(k => `${k}:${arg(call.args[k])}`).join(',')}}<tool_call|>`;
}
