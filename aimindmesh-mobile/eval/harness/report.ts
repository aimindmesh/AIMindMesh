/** Aggregates scenario runs into the report printed and saved under eval/results/ */
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Check } from './scoring';
import type { Category } from './types';

export interface RunRecord {
    id: string;
    category: Category;
    sample: number;
    ok: boolean;
    checks: Check[];
    answer: string;
    promptTokens: number;
    ms: number;
    extra?: Record<string, unknown>;
}

export function summarize(records: RunRecord[]) {
    const byCategory = new Map<Category, RunRecord[]>();
    for (const r of records) byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);
    const rows = [...byCategory.entries()].map(([category, rs]) => {
        const leaks = rs.filter(r => r.checks.some(c => c.name === 'no leaks' && !c.ok)).length;
        const lang = rs.filter(r => r.checks.some(c => c.name.startsWith('lang') && !c.ok)).length;
        return {
            category,
            runs: rs.length,
            passRate: Math.round((rs.filter(r => r.ok).length / rs.length) * 100),
            leaks,
            wrongLanguage: lang,
            avgPromptTokens: Math.round(rs.reduce((s, r) => s + r.promptTokens, 0) / rs.length),
            avgSeconds: +(rs.reduce((s, r) => s + r.ms, 0) / rs.length / 1000).toFixed(1),
        };
    });
    return rows;
}

export function writeReport(name: string, meta: Record<string, unknown>, records: RunRecord[]): string {
    const dir = new URL('../results/', import.meta.url).pathname;
    mkdirSync(dir, { recursive: true });
    const rows = summarize(records);
    const failures = records.filter(r => !r.ok).map(r =>
        `- **${r.id}** #${r.sample}: ${r.checks.filter(c => !c.ok).map(c => `${c.name}${c.detail ? ` (${c.detail})` : ''}`).join('; ')}\n  > ${r.answer.replace(/\s+/g, ' ').slice(0, 220)}`);
    const md = [
        `# Eval ${name}`, '', '```', JSON.stringify(meta, null, 1), '```', '',
        '| Category | Runs | Pass % | Leaks | Wrong lang | Prompt tok | s/run |', '| :-- | --: | --: | --: | --: | --: | --: |',
        ...rows.map(r => `| ${r.category} | ${r.runs} | ${r.passRate} | ${r.leaks} | ${r.wrongLanguage} | ${r.avgPromptTokens} | ${r.avgSeconds} |`),
        '', '## Failures', '', ...failures,
    ].join('\n');
    writeFileSync(`${dir}${name}.md`, md);
    writeFileSync(`${dir}${name}.json`, JSON.stringify({ meta, rows, records }, null, 1));
    return md;
}
