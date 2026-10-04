/**
 * Similarity thresholds of the memory search, measured on the phone's embedding model
 * (eval/calibration/pairs.json, Italian): cosine of matching query/passage pairs vs unrelated
 * ones and ordinary messages, as the app computes them (query/passage prefixes included).
 *   EVAL_DEVICE=serial  EVAL_EMBEDDING=model folder (required)  EVAL_PREFIX=e5|none  EVAL_PORT
 */
import { describe, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { DeviceSession } from './harness/deviceCdp';

const env = process.env;
const { pairs, noise } = JSON.parse(readFileSync(new URL('./calibration/pairs.json', import.meta.url), 'utf8')) as { pairs: Array<[string, string]>; noise: string[] };
const cos = (a: number[], b: number[]) => {
    let d = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return d / Math.sqrt(na * nb);
};
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))]; };
const r3 = (x: number) => Math.round(x * 1000) / 1000;

describe.skipIf(!env.EVAL_DEVICE)('memory thresholds on the phone', () => {
    it('measures related vs unrelated similarities', async () => {
        const device = await DeviceSession.open(env.EVAL_DEVICE!, Number(env.EVAL_PORT || 9300));
        try {
            const model = env.EVAL_EMBEDDING;
            // The native plugin directly, with the prefixes the app gives the model family
            // (EVAL_PREFIX=e5 | none): measures the corrected pipeline on any installed build
            const mode = env.EVAL_PREFIX || 'e5'; // e5: query/passage · qq: query on both sides · none
            const embedAll = (texts: string[], prefix: string) => device.evaluate<number[][]>(`(async () => {
                const T = window.Capacitor.Plugins.TextEmbedding;
                const status = await T.isModelLoaded();
                if (!status.loaded || !String(status.modelId).endsWith(${JSON.stringify(model ?? '')})) await T.loadModel({ modelDir: 'embedding_models/' + ${JSON.stringify(model ?? '')} });
                const out = [];
                for (const t of ${JSON.stringify(texts)}) out.push((await T.generateEmbedding({ text: ${JSON.stringify(prefix)} + t })).embedding);
                return out;
            })()`);
            const queries = await embedAll([...pairs.map(p => p[0]), ...noise], mode === 'none' ? '' : 'query: ');
            const passages = await embedAll(pairs.map(p => p[1]), mode === 'e5' ? 'passage: ' : mode === 'qq' ? 'query: ' : '');
            const related: number[] = [], unrelated: number[] = [], noiseSims: number[] = [];
            pairs.forEach((_, i) => passages.forEach((pv, j) => (i === j ? related : unrelated).push(cos(queries[i], pv))));
            noise.forEach((_, k) => passages.forEach(pv => noiseSims.push(cos(queries[pairs.length + k], pv))));
            // The threshold that keeps ≤5% of unrelated pairs while losing the fewest related ones
            const negatives = [...unrelated, ...noiseSims];
            const related95 = pct(negatives, 0.95), recallCut = pct(negatives, 0.9);
            // Chance that a matching pair scores above a non-matching one
            let wins = 0;
            for (const r of related) for (const n of negatives) wins += r > n ? 1 : r === n ? 0.5 : 0;
            const auc = wins / (related.length * negatives.length);
            const stats = {
                model: model ?? '(settings)', prefix: mode, auc: r3(auc), n: { related: related.length, unrelated: unrelated.length, noise: noiseSims.length },
                related: { min: r3(Math.min(...related)), p10: r3(pct(related, 0.1)), median: r3(pct(related, 0.5)) },
                unrelated: { median: r3(pct(unrelated, 0.5)), p90: r3(pct(unrelated, 0.9)), p95: r3(pct(unrelated, 0.95)), max: r3(Math.max(...unrelated)) },
                noise: { median: r3(pct(noiseSims, 0.5)), p95: r3(pct(noiseSims, 0.95)), max: r3(Math.max(...noiseSims)) },
                suggested: { related: r3(related95), recall: r3(recallCut) },
                kept: {
                    relatedAtRelated: r3(related.filter(x => x >= related95).length / related.length),
                    relatedAtRecall: r3(related.filter(x => x >= recallCut).length / related.length),
                },
            };
            console.log(JSON.stringify(stats, null, 1));
            const dir = new URL('./results/', import.meta.url).pathname;
            mkdirSync(dir, { recursive: true });
            writeFileSync(`${dir}calibration-${env.EVAL_DEVICE}-${model ?? 'settings'}.json`, JSON.stringify({ stats, related, unrelated, noise: noiseSims }, null, 1));
        } finally {
            device.close();
        }
    });
});
