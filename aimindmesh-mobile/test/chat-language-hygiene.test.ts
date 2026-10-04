import { describe, expect, it } from 'vitest';
import { detectLanguage, LANGUAGE_RULE, resolveLanguage } from '../src/services/llm/prompt/languageRule';
import { cleanAnswerText } from '../src/services/llm/prompt/answerHygiene';

describe('assistant language', () => {
    it('detects the language of a message', () => {
        expect(detectLanguage('Ricordi dove abito?')).toBe('it');
        expect(detectLanguage('Tell me a short fun fact about octopuses')).toBe('en');
        expect(detectLanguage('Ok')).toBeNull();
    });

    it('follows the setting, else the latest user messages, else the device', () => {
        expect(resolveLanguage('en', ['Ciao, come stai?'])).toBe('en');
        expect(resolveLanguage('auto', ['Che tempo fa domani a Varese?', 'Hello there my friend'])).toBe('it');
        expect(resolveLanguage('auto', ['ok', 'Tell me about the weather in Rome'])).toBe('en');
        expect(resolveLanguage('auto', ['ok'], 'en-US')).toBe('en');
        expect(resolveLanguage(undefined, [])).toBe('it');
        expect(LANGUAGE_RULE.it).toMatch(/italiano/);
    });
});

describe('answer hygiene', () => {
    it('removes what the Fold7 and the PC baseline showed in answers', () => {
        expect(cleanAnswerText('<tool_code>search_web({"query":"x"})</tool_code> <observation> [ {"snippet": "…"} ]')).toBe('');
        expect(cleanAnswerText("I remember your plans.\n\nIn Italian:\n\nMi ricordo che avevi in programma di correre 8 km.*"))
            .toBe('Mi ricordo che avevi in programma di correre 8 km.');
        expect(cleanAnswerText('Answer: Lisbona è la capitale.<turn|>')).toBe('Lisbona è la capitale.');
        expect(cleanAnswerText('<|channel>thought ragiono…<channel|>Ecco la risposta')).toBe('Ecco la risposta');
    });

    it('leaves normal text and markdown alone', () => {
        const text = 'Ecco **tre** consigli:\n\n1. Dormi bene\n2. *Bevi* acqua';
        expect(cleanAnswerText(text)).toBe(text);
    });
});
