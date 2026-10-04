/**
 * Texts of the compact on-device prompt, in the assistant's language. Small models (2–4B) follow
 * short instructions in the language they answer in; the long English companion prompt was
 * truncated on a 2048 context and made them switch language.
 */
import type { ResolvedLanguage } from './languageRule';

export interface PromptTexts {
    you: (name: string) => string;
    traits: string;
    knownHeader: string;
    comingUpHeader: string;
    relatedHeader: string;
    pastHeader: string;
    rules: string[];
    recall: string;
    today: (date: string, partOfDay: string) => string;
    partsOfDay: [string, string, string, string];
    nudge: string;
    toolError: (tool: string, error: string) => string;
    finalAnswer: string;
    /** No answer came even without reasoning */
    noAnswer: string;
    /** The model planned a tool in its reasoning and answered without calling it */
    callNow: (tool: string) => string;
    /** Rules for models that see the tools in their native format (no ReAct instructions) */
    toolRules: string[];
    /** Length of the answer: short (persona or concise style), medium, or no hint */
    length: { short: string; medium: string };
}

export const PROMPT_TEXTS: Record<ResolvedLanguage, PromptTexts> = {
    it: {
        you: name => `Sei ${name}, l'assistente personale dell'utente.`,
        traits: 'Carattere',
        knownHeader: "COSA SAI DELL'UTENTE (te l'ha detto lui; usalo con naturalezza, senza elencarlo)",
        comingUpHeader: "IN ARRIVO PER L'UTENTE (dopo, chiedigli com'è andata)",
        relatedHeader: 'ALTRE COSE CHE TI HA DETTO, PERTINENTI ORA',
        pastHeader: 'DA CONVERSAZIONI PASSATE (possono essere superate)',
        // No rule about how to answer: with tools offered, Gemma 4 E2B then answered instead of
        // calling (measured with the eval harness, 5/12 calls vs 12/12 without)
        rules: [
            "Usa quello che sai dell'utente quando serve. Se ti chiede qualcosa su di sé che non sai, digli che non te l'ha ancora detto: non dire mai che non hai memoria.",
            'Non inventare fatti. Per notizie, meteo o informazioni aggiornate usa gli strumenti, se ci sono.',
        ],
        recall: "L'UTENTE TI CHIEDE COSA RICORDI DI LUI. Rispondi da quello che sai (sopra e in questo contesto). Se non c'è, digli che non te l'ha detto; se sai qualcosa di collegato, dillo e chiedi. Non cercare sul web i suoi fatti personali.",
        today: (date, part) => `Oggi è ${date}, ${part}.`,
        partsOfDay: ['notte', 'mattina', 'pomeriggio', 'sera'],
        nudge: 'Continua: se hai finito, dai la risposta finale; se ti serve un dato, usa uno strumento.',
        toolError: (tool, error) => `Lo strumento ${tool} non ha funzionato: ${error}. Correggi gli argomenti o rispondi senza.`,
        finalAnswer: 'Ora rispondi all\'utente con quello che hai, senza altri strumenti.',
        toolRules: [
            "Per fare ciò che l'utente chiede (liste, sveglie, eventi, promemoria, ricerche) chiama lo strumento giusto.",
            "Non dire mai di aver fatto un'azione (promemoria, eventi, sveglie, liste) se non hai chiamato lo strumento che la fa.",
            "Per la vita dell'utente usa ciò che sai o search_memory, mai il web. Usa il risultato di uno strumento per la risposta.",
            'Per date e ore negli argomenti puoi scrivere le parole dell\'utente ("venerdì", "domani", "alle 15"): le converte l\'app.',
        ],
        callNow: tool => `Non hai ancora chiamato ${tool}: chiamalo adesso con gli argomenti giusti, poi rispondi.`,
        noAnswer: 'Non sono riuscito a formulare una risposta: puoi riformulare la domanda?',
        length: { short: 'Rispondi in breve: due o tre frasi al massimo.', medium: 'Rispondi in modo completo ma senza dilungarti.' },
    },
    en: {
        you: name => `You are ${name}, the user's personal assistant.`,
        traits: 'Character',
        knownHeader: 'WHAT YOU KNOW ABOUT THE USER (they told you; use it naturally, never list it)',
        comingUpHeader: 'COMING UP FOR THE USER (ask how it went afterwards)',
        relatedHeader: 'OTHER THINGS THEY TOLD YOU, RELEVANT NOW',
        pastHeader: 'FROM PAST CONVERSATIONS (may be outdated)',
        rules: [
            "Use what you know about the user when it helps. If they ask about themselves and you don't know, say they haven't told you yet: never say you have no memory.",
            "Don't invent facts. For news, weather or current information use the tools, if any.",
        ],
        recall: 'THE USER IS ASKING WHAT YOU REMEMBER ABOUT THEM. Answer from what you know (above and in this context). If it is not there, say they have not told you; if you know something related, say it and ask. Never search the web for their personal facts.',
        today: (date, part) => `Today is ${date}, ${part}.`,
        partsOfDay: ['night', 'morning', 'afternoon', 'evening'],
        nudge: 'Continue: if you are done, give the final answer; if you need data, use a tool.',
        toolError: (tool, error) => `The tool ${tool} failed: ${error}. Fix the arguments or answer without it.`,
        finalAnswer: 'Now answer the user with what you have, without more tools.',
        toolRules: [
            'To do what the user asks (lists, alarms, events, reminders, searches) call the right tool.',
            'Never say you did something (reminders, events, alarms, lists) unless you called the tool that does it.',
            "For the user's own life use what you know or search_memory, never the web. Use a tool's result for the reply.",
            'For dates and times in arguments you may write the user\'s words ("Friday", "tomorrow", "at 3 pm"): the app converts them.',
        ],
        callNow: tool => `You have not called ${tool} yet: call it now with the right arguments, then answer.`,
        noAnswer: "I couldn't put an answer together: could you rephrase the question?",
        length: { short: 'Keep it short: two or three sentences at most.', medium: 'Answer completely but without rambling.' },
    },
};

/** "domenica 4 ottobre 2026", "mattina": the hour is left out so the prompt (and the KV cache) lasts */
export function todayLine(lang: ResolvedLanguage, now: Date = new Date()): string {
    const texts = PROMPT_TEXTS[lang];
    const date = now.toLocaleDateString(lang === 'it' ? 'it-IT' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const h = now.getHours();
    const part = texts.partsOfDay[h < 6 ? 0 : h < 13 ? 1 : h < 19 ? 2 : 3];
    return texts.today(date, part);
}

/** Hint for the answer tokens: ≤ 300 short (Atlas 250, Aria 300), ≤ 600 medium (concise style 512) */
export function lengthHint(lang: ResolvedLanguage, answerTokens?: number): string {
    if (!answerTokens) return '';
    const t = PROMPT_TEXTS[lang].length;
    return answerTokens <= 300 ? t.short : answerTokens <= 600 ? t.medium : '';
}
