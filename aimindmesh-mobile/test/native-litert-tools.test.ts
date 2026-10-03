import { describe, expect, it } from 'vitest';
import { buildLiteRTToolSpecs } from '../src/services/llm/providers/liteRT/toolSchema';
import type { ToolDefinition } from '../src/services/tools/types';

const tool = (name: string, extra: Partial<ToolDefinition> = {}): ToolDefinition => ({
    name,
    description: `${name} description`,
    parameters: {
        type: 'OBJECT' as ToolDefinition['parameters']['type'],
        properties: {
            query: { type: 'STRING', description: 'What to look for' } as any,
            mode: { type: 'STRING', description: 'Mode', enum: ['fast', 'full'] } as any,
            tags: { type: 'ARRAY', description: 'Tags', items: { type: 'STRING' } } as any,
        },
        required: ['query'],
    },
    requiresConfirmation: false,
    category: 'web',
    ...extra,
});

describe('buildLiteRTToolSpecs', () => {
    it('keeps the real name, description and a JSON schema for every tool', () => {
        const [spec] = buildLiteRTToolSpecs([tool('search_web')]);
        expect(spec.name).toBe('search_web');
        expect(spec.description).toBe('search_web description');
        expect(spec.parameters).toEqual({
            type: 'object',
            properties: {
                query: { type: 'string', description: 'What to look for' },
                mode: { type: 'string', description: 'Mode', enum: ['fast', 'full'] },
                tags: { type: 'array', description: 'Tags', items: { type: 'string' } },
            },
            required: ['query'],
        });
    });

    it('skips denied tools and keeps allowed or unlisted ones', () => {
        const specs = buildLiteRTToolSpecs(
            [tool('a'), tool('b'), tool('c')],
            { a: 'deny', b: 'allow' }
        );
        expect(specs.map(s => s.name)).toEqual(['b', 'c']);
    });

    it('does not share the required array with the source definition', () => {
        const source = tool('x');
        const [spec] = buildLiteRTToolSpecs([source]);
        (spec.parameters.required as string[]).push('extra');
        expect(source.parameters.required).toEqual(['query']);
    });
});
