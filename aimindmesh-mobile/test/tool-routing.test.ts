import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));

import { resetToolRoutingForTests, routeTools, toolsForText } from '../src/services/tools/routing/toolRouter';
import { checkToolArgs } from '../src/services/tools/routing/toolArgs';

// Thursday 1 October 2026
const THU = new Date(2026, 9, 1, 18).getTime();

describe('tool router', () => {
    beforeEach(() => resetToolRoutingForTests());

    it.each([
        ['Che tempo fa domani a Como?', ['search_web', 'read_web_page']],
        ['Leggimi https://example.org/pagina', ['read_web_page']],
        ['Ricordami di chiamare il medico lunedì', ['create_calendar_event', 'create_task']],
        ['Fissa un appuntamento con il commercialista giovedì alle 10', ['create_calendar_event']],
        ['Cosa ho in agenda domani?', ['list_calendar_events', 'list_tasks']],
        ['Metti le uova nella lista della spesa', ['add_shopping_item']],
        ['Svegliami alle 6 e mezza', ['set_alarm']],
        ['apri whatsapp', ['launch_app']],
        ['Ricordati che il mio medico si chiama Bassi', ['save_memory']],
        ['Dimentica dove lavoro', ['search_memory', 'forget_memory']],
    ])('%s → %j', (text, tools) => {
        expect(toolsForText(text)).toEqual(tools);
    });

    it.each(['Ciao, come va?', 'Scrivimi una filastrocca', 'Quanto fa 7 per 8?', 'Dove abito?', 'Apri la mente, dimmi una cosa bella'])('no tools for "%s"', text => {
        expect(toolsForText(text)).toEqual([]);
    });

    it('keeps the tools of a conversation stable, in a fixed order', () => {
        expect(routeTools('Che tempo fa?', 't1')).toEqual(['search_web', 'read_web_page']);
        expect(routeTools('Grazie!', 't1')).toEqual(['search_web', 'read_web_page']);
        expect(routeTools('Svegliami alle 7', 't1')).toEqual(['search_web', 'read_web_page', 'set_alarm']);
        expect(routeTools('Grazie!', 't2')).toEqual([]);
    });
});

describe('tool arguments', () => {
    it('repairs dates, times and numbers the model wrote as words', () => {
        expect(checkToolArgs('create_calendar_event', { title: 'Dentista', date: 'giovedì', time: '15' }, THU))
            .toEqual({ args: { title: 'Dentista', date: '2026-10-08', time: '15:00' }, error: null }); // said on a Thursday: next week
        expect(checkToolArgs('create_task', { title: 'Affitto', due_date: 'venerdì' }, THU).args.due_date).toBe('2026-10-02');
        expect(checkToolArgs('set_alarm', { hour: '7', minute: '30' }, THU)).toEqual({ args: { hour: 7, minute: 30 }, error: null });
        expect(checkToolArgs('create_calendar_event', { title: 'X', date: 'domani', time: 'alle 15' }, THU).args.time).toBe('15:00');
    });

    it('reports what cannot be repaired', () => {
        expect(checkToolArgs('create_calendar_event', { title: 'X', date: 'boh', time: 'presto' }, THU).error)
            .toBe('date must be a date YYYY-MM-DD; time must be a time HH:MM');
        expect(checkToolArgs('search_web', {}, THU).error).toBe('query is required');
        expect(checkToolArgs('mystery_tool', {}, THU).error).toBe('unknown tool mystery_tool');
    });
});
