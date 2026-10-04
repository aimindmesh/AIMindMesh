/**
 * Prompt of the memory consolidation, in the assistant's language. The model copies the user's
 * words ("evidence") and the date words as said ("when"); the app checks the quote against the
 * user's messages and computes the date (factGate): small models got dates wrong, merged two
 * facts into one and stored the assistant's suggestions.
 */
import type { Message } from '../../../types';
import type { ResolvedLanguage } from '../../llm/prompt/languageRule';
import { Fact, FACT_KINDS } from './factTypes';

export const MAX_OPS = 5;

export const CONSOLIDATION_SYSTEM_PROMPTS: Record<ResolvedLanguage, string> = {
    it: "Gestisci la memoria a lungo termine di un assistente personale sul suo utente. Rispondi solo con JSON.",
    en: 'You maintain the long-term memory of a personal assistant about its user. You answer with JSON only.',
};

/** English system prompt (tasks that do not know the language) */
export const CONSOLIDATION_SYSTEM_PROMPT = CONSOLIDATION_SYSTEM_PROMPTS.en;

const pad = (n: number) => String(n).padStart(2, '0');
export const localDay = (time: number) => {
    const d = new Date(time);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const stamp = (time: number) => {
    const d = new Date(time);
    return `${localDay(time)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

interface Texts {
    today: (day: string, weekday: string) => string;
    known: string;
    nothing: string;
    conversation: string;
    user: string;
    assistant: string;
    schema: (max: number) => string;
    kinds: string;
    fields: string[];
    rules: string[];
    category: (list: string) => string;
}

const TEXTS: Record<ResolvedLanguage, Texts> = {
    it: {
        today: (day, weekday) => `Oggi è ${weekday} ${day}.`,
        known: "Cosa l'assistente sa già dell'utente (non aggiungerlo di nuovo):",
        nothing: '(ancora niente)',
        conversation: "Nuova conversazione (le righe dell'assistente sono solo contesto: conta solo ciò che l'UTENTE ha detto o confermato):",
        user: 'Utente',
        assistant: 'Assistente',
        schema: max => `Rispondi SOLO con un oggetto JSON {"ops": [...]}, al massimo ${max} operazioni:
- {"op":"add","kind":"<tipo>","content":"<fatto>","importance":<1-5>,"subject":"<persona, se non è l'utente>","when":"<parole della data>","evidence":"<parole dell'utente>"}
- {"op":"update","ref":"F2","content":"<il fatto com'è ora>","when":"<parole della data>","evidence":"<parole dell'utente>"} quando l'utente ha cambiato o corretto un fatto noto
- {"op":"done","ref":"F3","evidence":"<parole dell'utente>"} quando un impegno noto è fatto o un evento è passato`,
        kinds: `"kind": ${FACT_KINDS.join(', ')} (commitment = qualcosa che l'utente deve fare, event = qualcosa che succede in un giorno preciso, routine = un'abitudine che si ripete)`,
        fields: [
            '"content": una frase breve in italiano, in terza persona sull\'utente, con i nomi, i luoghi e i numeri che ha detto.',
            '"when": le parole della data come le ha dette l\'utente (per esempio "sabato", "domani alle 10", "il 12 ottobre"); lascialo vuoto per i fatti senza data e per le abitudini. Non calcolare la data: lo fa l\'app.',
            '"evidence": la frase dell\'utente da cui viene il fatto, copiata parola per parola.',
            '"importance": 5 = chi è l\'utente e le persone più vicine, 3 = utile, 1 = curiosità.',
        ],
        rules: [
            'Un fatto per operazione: se una frase contiene due fatti, sono due "add" (per esempio "Ho una figlia, Marta, e domenica corro la maratona" → "Ha una figlia di nome Marta" e "Corre la maratona", con when "domenica").',
            "Solo fatti duraturi utili in futuro, o impegni ed eventi con un giorno. Niente chiacchiere, domande, richieste del momento, e niente di ciò che dice o propone l'assistente.",
            'Anche le abitudini che si ripetono ("ogni martedì", "tutte le mattine") vanno ricordate: kind routine, senza "when".',
            'Non inventare nulla. Se non c\'è niente da ricordare rispondi {"ops": []}.',
        ],
        category: list => `"category": una tra ${list} (facoltativo)`,
    },
    en: {
        today: (day, weekday) => `Today is ${weekday} ${day}.`,
        known: 'What the assistant already knows about the user (do not add these again):',
        nothing: '(nothing yet)',
        conversation: "New conversation (the assistant's lines are only context: only what the USER said or confirmed counts):",
        user: 'User',
        assistant: 'Assistant',
        schema: max => `Return ONLY a JSON object {"ops": [...]} with at most ${max} operations:
- {"op":"add","kind":"<kind>","content":"<fact>","importance":<1-5>,"subject":"<person, if not the user>","when":"<date words>","evidence":"<the user's words>"}
- {"op":"update","ref":"F2","content":"<the fact as it is now>","when":"<date words>","evidence":"<the user's words>"} when the user changed or corrected a known fact
- {"op":"done","ref":"F3","evidence":"<the user's words>"} when a known commitment was done or an event is over`,
        kinds: `"kind": ${FACT_KINDS.join(', ')} (commitment = something the user has to do, event = something happening on a given day, routine = a habit that repeats)`,
        fields: [
            '"content": one short sentence in English, in the third person about the user, with the names, places and numbers they gave.',
            '"when": the date words as the user said them (e.g. "Saturday", "tomorrow at 10", "October 12"); empty for facts with no date and for habits. Do not compute the date: the app does.',
            '"evidence": the user\'s sentence the fact comes from, copied word for word.',
            '"importance": 5 = who the user is and the people closest to them, 3 = useful, 1 = trivia.',
        ],
        rules: [
            'One fact per operation: a sentence with two facts gives two "add" (e.g. "I have a daughter, Marta, and on Sunday I run the marathon" → "Has a daughter named Marta" and "Runs the marathon", when "Sunday").',
            'Only lasting facts useful in the future, or commitments and events with a day. No small talk, questions, one-off requests, and nothing the assistant says or suggests.',
            'Habits that repeat ("every Tuesday", "every morning") are worth remembering too: kind routine, no "when".',
            'Never invent anything. If nothing is worth remembering, answer {"ops": []}.',
        ],
        category: list => `"category": one of ${list} (optional)`,
    },
};

export function buildConsolidationPrompt(options: {
    batch: Message[];
    known: Fact[];
    now: number;
    maxChars: number;
    categories?: string[];
    lang?: ResolvedLanguage;
}): string {
    const { batch, known, now, categories } = options;
    const lang = options.lang ?? 'en';
    const t = TEXTS[lang];
    const weekday = new Date(now).toLocaleDateString(lang === 'it' ? 'it-IT' : 'en-US', { weekday: 'long' });
    const knownLines = known.map((f, i) =>
        `F${i + 1} [${f.kind}${f.dueAt ? `, ${localDay(f.dueAt)}` : ''}] ${f.subject ? `${f.subject}: ` : ''}${f.content}`);
    const conversation = batch.map(m =>
        `[${stamp(new Date(m.timestamp).getTime() || now)}] ${m.role === 'user' ? t.user : t.assistant}: ${m.text.slice(0, options.maxChars)}`);
    const fields = [t.kinds, ...t.fields];
    if (categories && categories.length > 0) fields.push(t.category(categories.map(c => `"${c}"`).join(', ')));

    return `${t.today(localDay(now), weekday)}

${t.known}
${knownLines.length > 0 ? knownLines.join('\n') : t.nothing}

${t.conversation}
${conversation.join('\n')}

${t.schema(MAX_OPS)}
${fields.map(f => `- ${f}`).join('\n')}
${t.rules.map(r => `- ${r}`).join('\n')}`;
}

/**
 * GBNF for the answer (GenieX llama_cpp runtime, llama-server): a JSON object with an "ops"
 * array; each operation starts with "op" (add, update, done — small models put the kind there),
 * "kind" is one of the fact kinds, "importance" a digit, the other known keys strings.
 * Whitespace is one character at most, so a small model cannot loop on blanks.
 */
export const FACT_OPS_GRAMMAR = String.raw`root ::= "{" ws "\"ops\"" ws ":" ws "[" ws ( op ( ws "," ws op )* )? ws "]" ws "}"
op ::= "{" ws "\"op\"" ws ":" ws opname ( ws "," ws pair )* ws "}"
opname ::= "\"add\"" | "\"update\"" | "\"done\""
pair ::= "\"kind\"" ws ":" ws kind | "\"importance\"" ws ":" ws [1-5] | "\"" key "\"" ws ":" ws string
kind ::= ${FACT_KINDS.map(k => `"\\"${k}\\""`).join(' | ')}
key ::= "content" | "subject" | "when" | "evidence" | "ref" | "category"
string ::= "\"" ( [^"\\\x7F\x00-\x1F] | "\\" ["\\/bfnrt] )* "\""
ws ::= [ \n]?`;
