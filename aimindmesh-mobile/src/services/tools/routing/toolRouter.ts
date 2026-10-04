/**
 * Which tools an on-device model is offered for a turn: 0–4 chosen by intent (Italian and
 * English), no LLM call. Small models offered 16 tools picked them at random (list_tasks for a
 * greeting, a web search for "where do I live"); offered none for small talk they just answer.
 * The set is sticky per conversation (union of the tools routed so far, in a fixed order): tools
 * are declared in the system turn, and a set that changed every turn would make the engine
 * read the whole prompt again.
 */
import { ON_DEVICE_TOOLS } from '../nativeToolDeclarations';

const INTENTS: Array<[RegExp, string[]]> = [
    // Current information: weather, news, prices, results, explicit searches
    [/\b(meteo|che tempo fa|previsioni|piover[àa]|nevic|weather|forecast|notizie|news|ultime|cerca\b|cercami|search\b|look up|google|prezzo|quanto costa|risultat[oi]|classifica|orari[oi]? (del|dei|di)|chi ha vinto)/i, ['search_web', 'read_web_page']],
    [/https?:\/\/\S+|\bwww\.\S+/i, ['read_web_page']],
    // Calendar
    [/\b(segna|metti|aggiungi|fissa|crea|schedule|add|put)\b[^.?!]{0,40}\b(agenda|calendario|calendar|appuntamento|evento|riunione|meeting|appointment)\b|\b(appuntamento|riunione|visita) (con|dal|dalla|da)\b/i, ['create_calendar_event']],
    [/\b(che|quali) (impegni|appuntamenti|eventi)\b|\b(agenda|calendario) (di|per) (oggi|domani|questa settimana)|\bcosa (ho|c'è) (oggi|domani|in agenda|in calendario)|\bwhat'?s on my (calendar|agenda)|\bmy (schedule|appointments)\b/i, ['list_calendar_events', 'list_tasks']],
    // Tasks and reminders
    [/\b(ricordami|promemoria|remind me|reminder|devo ricordarmi|to-?do|aggiungi (un|una)? ?(attività|task))/i, ['create_task', 'create_calendar_event']],
    [/\b(quali|che|le mie|elenca|mostra(mi)?) (attività|task|cose da fare)|\bcosa (mi resta|devo) (ancora )?(da )?fare|\b(my|list) (tasks|to-?dos)\b/i, ['list_tasks']],
    [/\b(ho (fatto|finito|completato)|segna(la)? come (fatt|complet)|mark (it )?(as )?done|completed?)\b/i, ['list_tasks', 'complete_task']],
    [/\blista della spesa|\bspesa\b|\bshopping list\b|\bda comprare\b|\b(compra|comprare)\b/i, ['add_shopping_item']],
    // Device
    [/\bsveglia|svegliami|\balarm\b|wake me/i, ['set_alarm']],
    [/\b(apri|avvia|lancia|open|launch)\s+(l'app(licazione)?\s+|app\s+|the app\s+)?(?!(il|la|lo|le|gli|un|una|the|a|an|my|mio|mia)\b)\p{L}/iu, ['launch_app']],
    [/\bluminosit[àa]|\bbrightness\b|schermo (più|meno) (chiaro|scuro)/i, ['set_brightness']],
    [/\bvolume\b|\b(alza|abbassa) (la musica|l'audio|il suono)/i, ['set_volume']],
    [/\btermux\b|\bshell\b|\bcomando\b|\bterminal\b|\bpkg install\b|\b(i|dei|questi) file\b|\b(cartella|cartelle|directory|folder|files)\b/i, ['run_termux_command']],
    // Memory: "remember that…" is saved through the fact gate; "forget…" needs the fact's id
    [/\b(ricordati|ricorda) che\b|\bsegnati che\b|\bnon dimenticare che\b|\bremember that\b|\bkeep in mind that\b/i, ['save_memory']],
    [/\b(dimentica|scordati|cancella dalla memoria|forget)\b/i, ['search_memory', 'forget_memory']],
];

const MAX_TOOLS = 4;
/** Above this the sticky set starts over from the current turn */
const MAX_STICKY = 6;

const sticky = new Map<string, Set<string>>();

/** Tools the text asks for, in the fixed order, at most four */
export function toolsForText(text: string): string[] {
    const wanted = new Set<string>();
    for (const [pattern, tools] of INTENTS) if (pattern.test(text)) tools.forEach(t => wanted.add(t));
    return ON_DEVICE_TOOLS.filter(t => wanted.has(t)).slice(0, MAX_TOOLS);
}

/**
 * Tools to offer for this turn of a conversation: the routed ones plus those offered earlier in
 * the same conversation (empty when nothing in it ever needed a tool).
 */
export function routeTools(text: string, conversationId?: string | null): string[] {
    const now = toolsForText(text);
    if (!conversationId) return now;
    const previous = sticky.get(conversationId) ?? new Set<string>();
    let union = new Set([...previous, ...now]);
    if (union.size > MAX_STICKY) union = new Set(now);
    sticky.set(conversationId, union);
    return ON_DEVICE_TOOLS.filter(t => union.has(t));
}

export function resetToolRoutingForTests(): void {
    sticky.clear();
}
