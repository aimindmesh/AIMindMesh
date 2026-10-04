/**
 * Kind of a fact by rules, when the model left it 'other' (inline and tool facts had no kind at
 * all, so they never became open loops or identity facts). Italian and English.
 */
import type { FactKind } from './factTypes';

const RULES: Array<[FactKind, RegExp]> = [
    ['routine', /\b(ogni|tutti i|tutte le|di solito|abitualmente|every|usually|each)\b/i],
    ['identity', /\b(vive|abita|vivo|abito|lavora|lavoro come|fa (il|la|l')\w*|mi chiamo|è nat[oa]|sono nat[oa]|ha \d+ anni|studia|lives|works as|works at|was born|years old|studies)\b/i],
    ['person', /\b(moglie|marito|figli[oa]?|madre|padre|mamma|papà|fratell[oi]|sorell[ae]|amic[oa]|fidanzat[oa]|compagn[oa]|collega|cane|gatt[oa]|nonn[oa]|wife|husband|son|daughter|mother|father|mum|mom|dad|brother|sister|friend|girlfriend|boyfriend|partner|colleague|dog|cat)\b/i],
    ['preference', /\b(piace|piacciono|ama|adora|odia|detesta|preferisce|non sopporta|likes?|loves?|hates?|prefers?|enjoys?|can't stand)\b/i],
    ['goal', /\b(vuole|vorrebbe|sogna di|obiettivo|punta a|wants to|would like to|dreams? of|goal)\b/i],
];
const OBLIGATION = /\b(deve|devo|dovrà|ricordarsi di|da fare|pagare|chiamare|consegnare|has to|must|needs to|should|pay|call)\b/i;

export function guessKind(content: string, dueAt?: number): FactKind {
    if (dueAt !== undefined) return OBLIGATION.test(content) ? 'commitment' : 'event';
    for (const [kind, rule] of RULES) if (rule.test(content)) return kind;
    return 'other';
}
