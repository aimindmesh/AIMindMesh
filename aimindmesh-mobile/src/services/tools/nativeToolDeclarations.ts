/**
 * Tool declarations in the JSON-schema form chat templates take (OpenAI style: lowercase types),
 * for engines that render tools natively (Gemma 4 `<|tool>declaration:…`, Qwen `<tools>`).
 * The catalog uses the Gemini schema (uppercase `Type`).
 */
import { TOOL_DEFINITIONS, isToolOffered } from '../toolDefinitions';
import type { ToolDefinition, ToolParameter } from './types';

export interface ToolDeclaration {
    type: 'function';
    function: { name: string; description: string; parameters?: Record<string, unknown> };
}

/**
 * On-device tools until the per-turn router chooses them: the same set the compact ReAct prompt
 * offered, plus the memory and alarm tools its list missed.
 */
export const ON_DEVICE_TOOLS = [
    'search_web', 'read_web_page', 'create_calendar_event', 'list_calendar_events', 'create_task', 'list_tasks',
    'complete_task', 'add_shopping_item', 'launch_app', 'set_brightness', 'set_volume', 'set_alarm',
    'search_memory', 'save_memory', 'forget_memory', 'run_termux_command',
];

const lower = (type: unknown) => String(type).toLowerCase();

function parameterSchema(p: ToolParameter): Record<string, unknown> {
    return {
        type: lower(p.type),
        description: p.description,
        ...(p.enum ? { enum: p.enum } : {}),
        ...(p.items ? { items: { type: lower(p.items.type) } } : {}),
    };
}

export function declarationOf(tool: ToolDefinition): ToolDeclaration {
    const properties = Object.fromEntries(Object.entries(tool.parameters.properties).map(([k, p]) => [k, parameterSchema(p)]));
    return {
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description,
            ...(Object.keys(properties).length > 0
                ? { parameters: { type: 'object', properties, required: tool.parameters.required ?? [] } }
                : {}),
        },
    };
}

/** Declarations of the named tools the user allows (in the given order; unknown names skipped) */
export function toolDeclarations(names: string[], toolRules: Record<string, string> = {}): ToolDeclaration[] {
    return names.flatMap(name => {
        const tool = TOOL_DEFINITIONS.find(t => t.name === name);
        return tool && isToolOffered(tool, toolRules) ? [declarationOf(tool)] : [];
    });
}
