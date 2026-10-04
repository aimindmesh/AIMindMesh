/** Deterministic scoring of one run of a scenario */
import type { Expectation, Scenario } from './types';

const IT_WORDS = new Set('il lo la gli le un una di da con su per tra fra che non è sono sei hai ho ha abbiamo del della dei delle al alla nel nella ma come cosa quando dove perché anche più molto ti mi si ci se o e questo questa quello sì grazie ciao puoi posso vuoi sempre già ancora'.split(' '));
const EN_WORDS = new Set('the an of to on with for at by from that this is are was were be been have has had do does did not and or but if you your my me we it its as can will would should could there what when where why how which about'.split(' '));

/** 'it' | 'en' | null (too short to tell). Words of both languages (a, i, in) are left out */
export function detectLanguage(text: string): 'it' | 'en' | null {
    const words = text.toLowerCase().match(/\p{L}+/gu) || [];
    if (words.length < 4) return null;
    let it = 0, en = 0;
    for (const w of words) {
        if (IT_WORDS.has(w)) it++;
        if (EN_WORDS.has(w)) en++;
    }
    if (it === 0 && en === 0) return null;
    return it >= en ? 'it' : 'en';
}

export const LEAKS = /Answer\s*:|In Italian\s*:|<\/?tool\b|<\|?\/?channel\|?>|<\/?think(ing)?>|<save_memory>|<\|turn>|<turn\|>|<\|tool_call>|Observation\s*:|<\/?start_of_turn>|<\|im_(start|end)\|>/i;
export const DENIAL = /non ho (accesso a(lla|lle)? )?(memori|ricord)|non (posso|riesco a) ricordare|non ho (alcuna |nessuna )?(informazion[ei] )?memoria|i (don't|do not) have (any )?(memor|access)|no memor(y|ies) of/i;

export interface Check { name: string; ok: boolean; detail?: string }

const rx = (s: string) => new RegExp(s, 'i');

export function scoreAnswer(answer: string, expect: Expectation): Check[] {
    const checks: Check[] = [];
    for (const p of expect.mustInclude ?? []) checks.push({ name: `include /${p}/`, ok: rx(p).test(answer) });
    if (expect.anyOf?.length) checks.push({ name: `anyOf ${expect.anyOf.length}`, ok: expect.anyOf.some(p => rx(p).test(answer)) });
    for (const p of expect.mustNotInclude ?? []) checks.push({ name: `exclude /${p}/`, ok: !rx(p).test(answer) });
    if (expect.lang) {
        const lang = detectLanguage(answer);
        checks.push({ name: `lang ${expect.lang}`, ok: lang === null || lang === expect.lang, detail: lang ?? 'short' });
    }
    checks.push({ name: 'no leaks', ok: !LEAKS.test(answer), detail: answer.match(LEAKS)?.[0] });
    return checks;
}

export function scoreToolCall(calls: Array<{ name: string; args: Record<string, unknown> }>, expect: Expectation): Check[] {
    if (expect.tool === undefined) return [];
    const first = calls[0];
    if (expect.tool === null) return [{ name: 'no tool', ok: !first, detail: first?.name }];
    const wanted = Array.isArray(expect.tool) ? expect.tool : [expect.tool];
    // null in the list: answering without a tool is right too
    if (!first && wanted.includes(null)) return [{ name: `tool ${wanted.join('|')}`, ok: true, detail: 'none' }];
    const right = !!first && wanted.includes(first.name);
    const checks: Check[] = [{ name: `tool ${wanted.join('|')}`, ok: right, detail: first?.name ?? 'none' }];
    if (right) {
        for (const [arg, patterns] of Object.entries(expect.args ?? {})) {
            const value = JSON.stringify(first.args?.[arg] ?? '');
            checks.push({ name: `arg ${arg}`, ok: patterns.every(p => rx(p).test(value)), detail: value.slice(0, 80) });
        }
    }
    return checks;
}

export interface SavedFact { content: string; kind: string; dueAt?: number }

export function scoreFacts(saved: SavedFact[], expect: Expectation, now: number): Check[] {
    const checks: Check[] = [];
    const used = new Set<number>();
    const assigned = bestAssignment(saved, expect.facts ?? []);
    for (const [w, want] of (expect.facts ?? []).entries()) {
        const i = assigned[w];
        if (i < 0) { checks.push({ name: `fact /${want.match}/`, ok: false, detail: 'missing' }); continue; }
        used.add(i);
        const f = saved[i];
        if (want.kind) checks.push({ name: `kind ${want.kind}`, ok: f.kind === want.kind, detail: f.kind });
        if (want.dueWeekday !== undefined) {
            const expected = nextWeekday(now, want.dueWeekday);
            checks.push({ name: `due weekday ${want.dueWeekday}`, ok: f.dueAt !== undefined && startOfDay(f.dueAt) === expected, detail: f.dueAt ? new Date(f.dueAt).toISOString().slice(0, 10) : 'none' });
        }
        if (want.dueInDays !== undefined) {
            const ok = want.dueInDays === 'none' ? f.dueAt === undefined
                : f.dueAt !== undefined && Math.round((startOfDay(f.dueAt) - startOfDay(now)) / 86_400_000) === want.dueInDays;
            checks.push({ name: `due ${want.dueInDays}`, ok, detail: f.dueAt ? new Date(f.dueAt).toISOString().slice(0, 10) : 'none' });
        }
        checks.push({ name: `fact /${want.match}/`, ok: true });
    }
    const junk = saved.filter((_, idx) => !used.has(idx));
    if (expect.facts || expect.noFacts) checks.push({ name: 'no junk facts', ok: junk.length === 0, detail: junk.map(f => f.content).join(' | ').slice(0, 160) });
    return checks;
}

const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Start of the next given weekday (0 = Sunday) after today */
function nextWeekday(now: number, weekday: number): number {
    const d = new Date(startOfDay(now));
    const ahead = (weekday - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + ahead);
    return d.getTime();
}

export function scoreRemember(saved: string[], toolCalls: Array<{ name: string; args: Record<string, unknown> }>, pattern: string | undefined): Check[] {
    if (!pattern) return [];
    const viaTool = toolCalls.some(c => c.name === 'save_memory' && rx(pattern).test(JSON.stringify(c.args)));
    return [{ name: `remembers /${pattern}/`, ok: viaTool || saved.some(s => rx(pattern).test(s)), detail: saved.join(' | ').slice(0, 120) || 'nothing saved' }];
}

export const passed = (checks: Check[]) => checks.every(c => c.ok);
export type { Scenario };

/**
 * Which saved fact answers each expected one: the assignment matching the most expectations
 * (a fact "porterà Pepe dal veterinario" must not take /Pepe/ when "ha un cane di nome Pepe"
 * is there too). -1 for an expectation no fact can take.
 */
function bestAssignment(saved: SavedFact[], wanted: Array<{ match: string }>): number[] {
    let best: number[] = wanted.map(() => -1);
    let bestCount = -1;
    const current: number[] = [];
    const taken = new Set<number>();
    const walk = (w: number, count: number) => {
        if (w === wanted.length) {
            if (count > bestCount) { bestCount = count; best = [...current]; }
            return;
        }
        for (let i = 0; i < saved.length; i++) {
            if (taken.has(i) || !rx(wanted[w].match).test(saved[i].content)) continue;
            taken.add(i); current.push(i);
            walk(w + 1, count + 1);
            taken.delete(i); current.pop();
        }
        current.push(-1);
        walk(w + 1, count);
        current.pop();
    };
    walk(0, 0);
    return best;
}
