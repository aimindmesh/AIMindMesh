import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, version: 'test', getDocument: () => { throw new Error('no PDFs'); } }));

import { formatGemma4ToolCall, parseGemma4ToolCalls } from '../src/services/llm/chatFormat/gemma4ToolCalls';
import { parseQwenToolCalls } from '../src/services/llm/chatFormat/qwenToolCalls';
import { parseToolCalls } from '../src/services/llm/chatFormat/toolCallParser';
import { modelFamily } from '../src/services/llm/chatFormat/modelFamily';

describe('Gemma 4 native tool calls', () => {
    it('reads the call Gemma 4 E2B emitted on llama.cpp b9309', () => {
        const out = '<|tool_call>call:search_web{query:<|"|>tempo domani a Varese<|"|>}<tool_call|>';
        expect(parseGemma4ToolCalls(out)).toEqual({ calls: [{ name: 'search_web', args: { query: 'tempo domani a Varese' } }], text: '' });
    });

    it('reads numbers, booleans, nested objects, arrays, several calls and text around them', () => {
        const out = 'Controllo subito. <|tool_call>call:create_task{title:<|"|>Pagare l\'affitto, entro venerdì<|"|>,priority:2,urgent:true,tags:[<|"|>casa<|"|>,<|"|>soldi<|"|>],meta:{source:<|"|>chat<|"|>}}<tool_call|>'
            + '<|tool_call>call:list_tasks{}<tool_call|>';
        const { calls, text } = parseGemma4ToolCalls(out);
        expect(text).toBe('Controllo subito.');
        expect(calls).toEqual([
            { name: 'create_task', args: { title: "Pagare l'affitto, entro venerdì", priority: 2, urgent: true, tags: ['casa', 'soldi'], meta: { source: 'chat' } } },
            { name: 'list_tasks', args: {} },
        ]);
    });

    it('accepts the bare form and JSON-style strings, drops truncated calls', () => {
        expect(parseGemma4ToolCalls('call:launch_app{app_name:"Spotify"}').calls).toEqual([{ name: 'launch_app', args: { app_name: 'Spotify' } }]);
        expect(parseGemma4ToolCalls('<|tool_call>call:search_web{query:<|"|>meteo Var').calls).toEqual([]);
        expect(parseGemma4ToolCalls('Ciao! Come posso aiutarti?')).toEqual({ calls: [], text: 'Ciao! Come posso aiutarti?' });
    });

    it('writes calls the way the template renders them, and reads them back', () => {
        const call = { name: 'add_shopping_item', args: { item: 'latte', quantity: 2 } };
        const text = formatGemma4ToolCall(call);
        expect(text).toBe('<|tool_call>call:add_shopping_item{item:<|"|>latte<|"|>,quantity:2}<tool_call|>');
        expect(parseGemma4ToolCalls(text).calls).toEqual([call]);
    });
});

describe('Qwen native tool calls and family detection', () => {
    it('reads JSON calls, tolerates trailing commas, skips broken blocks', () => {
        const out = '<tool_call>\n{"name": "search_web", "arguments": {"query": "meteo Varese",}}\n</tool_call>\n<tool_call>{"name": "x", "arguments": {';
        expect(parseQwenToolCalls(out)).toEqual({ calls: [{ name: 'search_web', args: { query: 'meteo Varese' } }], text: '<tool_call>{"name": "x", "arguments": {' });
    });

    it('picks the parser from the model and falls back to the ReAct format', () => {
        expect(modelFamily('/files/gemma-4-E2B_q4_0-it.gguf')).toBe('gemma4');
        expect(modelFamily('/files/models/genie/gemma_4_e4b_it-geniex_qairt')).toBe('gemma4');
        expect(modelFamily('/files/Qwen3.5-4B-Q4_0.gguf')).toBe('qwen3');
        expect(modelFamily('/files/phi-3.gguf')).toBe('generic');
        expect(parseToolCalls('<tool>search_web({"query":"meteo"})</tool>', 'gemma4').calls).toEqual([{ name: 'search_web', args: { query: 'meteo' } }]);
    });
});
