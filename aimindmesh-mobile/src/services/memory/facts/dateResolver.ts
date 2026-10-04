/**
 * Turns the date words a user said ("domani", "sabato prossimo", "tra due settimane", "il 12
 * ottobre", "next Friday") into a day, relative to when the message was written. Deterministic:
 * the extraction model only copies the words, the app does the calendar (small models got
 * dates wrong or left "tomorrow" in a fact that is false a day later).
 */

const DAY = 86_400_000;

const WEEKDAYS: Record<string, number> = {
    domenica: 0, lunedi: 1, 'lunedì': 1, martedi: 2, 'martedì': 2, mercoledi: 3, 'mercoledì': 3, giovedi: 4, 'giovedì': 4,
    venerdi: 5, 'venerdì': 5, sabato: 6,
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

const MONTHS: Record<string, number> = {
    gennaio: 0, febbraio: 1, marzo: 2, aprile: 3, maggio: 4, giugno: 5, luglio: 6, agosto: 7, settembre: 8, ottobre: 9, novembre: 10, dicembre: 11,
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    gen: 0, feb: 1, mar: 2, apr: 3, mag: 4, giu: 5, lug: 6, ago: 7, set: 8, ott: 9, nov: 10, dic: 11,
    jan: 0, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, dec: 11,
};

const NUMBER_WORDS: Record<string, number> = {
    un: 1, uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10, quindici: 15, venti: 20,
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20,
};

const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (t: number, n: number) => { const d = new Date(t); d.setDate(d.getDate() + n); return startOfDay(d.getTime()); };

function nextWeekday(ref: number, weekday: number, allowToday: boolean): number {
    const today = new Date(ref).getDay();
    let ahead = (weekday - today + 7) % 7;
    if (ahead === 0 && !allowToday) ahead = 7;
    return addDays(ref, ahead);
}

/** A day/month that has already passed this year means next year */
function dayOfMonth(ref: number, day: number, month: number, year?: number): number | undefined {
    if (day < 1 || day > 31 || month < 0 || month > 11) return undefined;
    const base = new Date(ref);
    const y = year ?? base.getFullYear();
    let d = new Date(y, month, day);
    if (d.getMonth() !== month) return undefined; // 31 febbraio
    if (year === undefined && startOfDay(d.getTime()) < startOfDay(ref)) d = new Date(y + 1, month, day);
    return startOfDay(d.getTime());
}

const n = (word: string) => /^\d+$/.test(word) ? Number(word) : NUMBER_WORDS[word];

/**
 * Start of the day the words refer to, or undefined when they name no date (or a recurring
 * one: "ogni sabato" is a routine, not a date).
 */
export function resolveWhen(words: string | undefined | null, refTime: number): number | undefined {
    const text = (words ?? '').toLowerCase().normalize('NFC').replace(/[’']/g, "'").trim();
    if (!text) return undefined;
    if (/\b(ogni|tutti i|tutte le|every|each)\b/.test(text)) return undefined;
    // "il sabato", "la domenica" (without "prossimo") is a habit in Italian: "on Saturdays"
    if (/(?<!\p{L})(il|la)\s+(luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica)(?!\p{L})(?!\s+(prossim|che viene))/u.test(text)) return undefined;
    const ref = refTime;

    // ISO and numeric dates: 2026-10-12, 12/10, 12/10/2026, 12.10.26
    let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
    let found = m ? dayOfMonth(ref, Number(m[3]), Number(m[2]) - 1, Number(m[1])) : undefined;
    if (found !== undefined) return found;
    // (a time like "10.30" or "alle 10.12" is not a date: the search goes on)
    m = /(?<!\b(?:alle|ore|dalle|verso le|at|h)\s?)\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/.exec(text);
    if (m) {
        const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : undefined;
        found = dayOfMonth(ref, Number(m[1]), Number(m[2]) - 1, year);
        if (found !== undefined) return found;
    }

    // "12 ottobre", "il 3 marzo 2027", "October 12", "12th of October"
    const monthNames = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
    m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+|di\\s+)?(${monthNames})\\b(?:\\s+(\\d{4}))?`).exec(text);
    found = m ? dayOfMonth(ref, Number(m[1]), MONTHS[m[2]], m[3] ? Number(m[3]) : undefined) : undefined;
    if (found !== undefined) return found;
    m = new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`).exec(text);
    found = m ? dayOfMonth(ref, Number(m[2]), MONTHS[m[1]], m[3] ? Number(m[3]) : undefined) : undefined;
    if (found !== undefined) return found;

    // Relative days
    if (/\b(dopodomani|day after tomorrow)\b/.test(text)) return addDays(ref, 2);
    if (/\b(domani|domattina|tomorrow)\b/.test(text)) return addDays(ref, 1);
    if (/\b(oggi|stasera|stamattina|stanotte|stamani|oggi pomeriggio|today|tonight|this (morning|afternoon|evening))\b/.test(text)) return startOfDay(ref);
    if (/\b(ieri|yesterday)\b/.test(text)) return addDays(ref, -1);

    // "tra/fra 3 giorni", "tra due settimane", "in 2 weeks", "a month from now"
    m = /\b(?:tra|fra|in|entro)\s+(\d+|\p{L}+)\s+(giorn[oi]|settiman[ae]|mes[ei]|days?|weeks?|months?)\b/u.exec(text);
    if (m && n(m[1]) !== undefined) {
        const count = n(m[1])!;
        if (/^(giorn|day)/.test(m[2])) return addDays(ref, count);
        if (/^(settiman|week)/.test(m[2])) return addDays(ref, count * 7);
        const d = new Date(startOfDay(ref));
        d.setMonth(d.getMonth() + count);
        return startOfDay(d.getTime());
    }

    // Weekdays: "sabato", "sabato prossimo", "questo venerdì", "next Friday", "on Monday"
    const weekdayNames = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join('|');
    // Unicode word boundaries: \b is ASCII-only and fails after "venerdì"
    m = new RegExp(`(?<!\\p{L})(${weekdayNames})(?!\\p{L})`, 'u').exec(text);
    if (m) {
        const weekday = WEEKDAYS[m[1]];
        const thisOne = /\b(questo|questa|this)\b/.test(text);
        // "sabato prossimo" said on Thursday is the coming Saturday, as "next Saturday" is
        return nextWeekday(ref, weekday, thisOne);
    }

    // Coarse periods
    if (/\b(weekend|fine settimana|fine-settimana)\b/.test(text)) return nextWeekday(ref, 6, /\b(questo|this)\b/.test(text));
    if (/\b(settimana prossima|prossima settimana|next week)\b/.test(text)) return nextWeekday(ref, 1, false);
    if (/\b(mese prossimo|prossimo mese|next month)\b/.test(text)) {
        const d = new Date(startOfDay(ref));
        d.setMonth(d.getMonth() + 1, 1);
        return startOfDay(d.getTime());
    }
    m = new RegExp(`\\b(?:a|ad|in|di|nel mese di)\\s+(${monthNames})\\b`).exec(text);
    if (m) return dayOfMonth(ref, 1, MONTHS[m[1]]);
    return undefined;
}

export const isPast = (dayStart: number, refTime: number) => dayStart < startOfDay(refTime);
export { DAY as ONE_DAY_MS };
