/**
 * Stand-in for `genie-capacitor` whose engine is a phone: formatChat, loadModel and
 * generateStream run in the app's WebView (Capacitor.Plugins.Genie) through DevTools, while the
 * app code under test runs on the PC (eval/run.eval.ts with EVAL_PHONE=<serial>). Prompt changes
 * are measured on the real NPU without rebuilding the APK.
 */
import { DeviceSession } from './deviceCdp';
import { shimState } from './genieShim';

let session: DeviceSession | null = null;
const device = async () => session ??= await DeviceSession.open(process.env.EVAL_PHONE!, Number(process.env.EVAL_PORT || 9300));

const plugin = (body: string) => `(async () => { const Genie = window.Capacitor.Plugins.Genie; ${body} })()`;

export const phoneShim = {
    async getCapabilities() { return (await device()).evaluate(plugin('return await Genie.getCapabilities();')); },
    async isLoaded() { return (await device()).evaluate(plugin('return await Genie.isLoaded();')); },
    async loadModel(options: unknown) { return (await device()).evaluate(plugin(`return await Genie.loadModel(${JSON.stringify(options)});`)); },
    async unloadModel() { return { success: true }; },
    async listLocalModels() { return { models: [] }; },
    async abortGeneration() { return (await device()).evaluate(plugin('return await Genie.abortGeneration();')); },
    async formatChat(options: unknown) { return (await device()).evaluate(plugin(`return await Genie.formatChat(${JSON.stringify(options)});`)); },
    async generateStream(options: { prompt: string }, callback: (result: unknown, err?: unknown) => void) {
        const out = await (await device()).evaluate<{ text: string; error?: string; profile?: any }>(plugin(`
            return await new Promise(resolve => {
                let text = '';
                Genie.generateStream(${JSON.stringify(options)}, (r, err) => {
                    if (err) return resolve({ text, error: String(err.message || err) });
                    if (!r) return;
                    if (r.text) text += r.text;
                    if (r.error) return resolve({ text, error: r.error });
                    if (r.done) resolve({ text, profile: r.profile });
                });
            });`));
        const p = out.profile ?? {};
        shimState.last = { prompt: options.prompt, output: out.text, promptTokens: p.promptTokens ?? 0, generatedTokens: p.generatedTokens ?? 0, ms: (p.promptTimeMs ?? 0) + (p.decodeTimeMs ?? 0) };
        shimState.calls.push(shimState.last);
        if (out.error) { callback({ done: true, error: out.error }); return 'phone'; }
        if (out.text) callback({ text: out.text, done: false });
        callback({ text: '', done: true, profile: out.profile });
        return 'phone';
    },
};
