/** Fixed benchmark prompts: the same text on every engine, so the results compare */

const TURNS = [
    ['user', 'Ciao! Oggi è stata una giornata piena: stamattina riunione con il team del progetto Atlante, poi pranzo veloce con Giulia.'],
    ['model', 'Che giornata! Com\'è andata la riunione sul progetto Atlante?'],
    ['user', 'Bene, abbiamo deciso di rilasciare la prima versione a fine novembre. Io mi occupo della parte di sincronizzazione dei dati.'],
    ['model', 'Ottimo, una scadenza chiara aiuta. La sincronizzazione è una parte delicata: hai già un piano?'],
    ['user', 'Più o meno. Devo ancora capire come gestire i conflitti quando due telefoni modificano la stessa nota offline.'],
    ['model', 'Potresti usare un orologio logico per nota e risolvere i conflitti campo per campo, tenendo traccia di chi ha modificato cosa.'],
    ['user', 'Ci penso. Ah, ricordami che giovedì alle 18 ho il dentista, e sabato devo portare la macchina dal meccanico.'],
    ['model', 'Segnato: dentista giovedì alle 18, meccanico sabato. Vuoi che ti avvisi il giorno prima?'],
    ['user', 'Sì grazie. Poi volevo dirti che ho ricominciato a correre: tre volte a settimana, di mattina presto, prima del lavoro.'],
    ['model', 'Bellissimo! Quanto corri di solito? Hai un obiettivo, come una gara?'],
    ['user', 'Per ora cinque chilometri, ma vorrei fare la mezza maratona di Torino in primavera. Mia sorella Anna la corre ogni anno.'],
    ['model', 'Una mezza maratona in primavera è un obiettivo realistico se aumenti gradualmente. Correre con Anna potrebbe motivarti.'],
] as const;

/** ~1500 tokens of conversation, like the memory consolidation reads */
export function buildPrefillText(): string {
    const lines: string[] = [];
    for (let round = 0; lines.join('\n').length < 5200; round++) {
        for (const [role, text] of TURNS) lines.push(`[day ${round + 1}] ${role === 'user' ? 'User' : 'Assistant'}: ${text}`);
    }
    return lines.join('\n');
}

export const PREFILL_REQUEST = 'From the conversation above, list the three most important facts about the user as a JSON array of short strings.';

export const DECODE_REQUEST = 'Write a detailed story of at least 400 words about a lighthouse keeper who finds a message in a bottle.';
