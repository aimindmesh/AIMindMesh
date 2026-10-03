import type { ToolDefinition } from '../../../tools/types';

/** Tool definition in the shape the native LiteRT plugin registers (JSON Schema parameters). */
export interface LiteRTToolSpec {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

type ToolRules = Record<string, string> | undefined;

/** Gemini `Type` enum values ('STRING', 'OBJECT', ...) → JSON Schema type names. */
function schemaType(type: unknown): string {
    return String(type ?? 'string').toLowerCase();
}

/**
 * Builds LiteRT tool specs from the app's TOOL_DEFINITIONS, skipping denied tools.
 * Pure (takes the list as input) so it can be unit tested without the tool modules.
 */
export function buildLiteRTToolSpecs(tools: ToolDefinition[], toolRules?: ToolRules): LiteRTToolSpec[] {
    return tools
        .filter(tool => ((toolRules ?? {})[tool.name] || 'confirm') !== 'deny')
        .map(tool => {
            const properties: Record<string, Record<string, unknown>> = {};
            for (const [name, prop] of Object.entries(tool.parameters?.properties ?? {})) {
                const schema: Record<string, unknown> = { type: schemaType(prop.type), description: prop.description };
                if (prop.enum && prop.enum.length > 0) schema.enum = prop.enum;
                if (prop.items) schema.items = { type: schemaType(prop.items.type) };
                properties[name] = schema;
            }
            return {
                name: tool.name,
                description: tool.description,
                parameters: {
                    type: 'object',
                    properties,
                    required: [...(tool.parameters?.required ?? [])],
                },
            };
        });
}
