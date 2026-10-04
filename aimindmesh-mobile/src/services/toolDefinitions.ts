/**
 * Tool Definitions for AI Function Calling
 * 
 * Defines all tools available to the AI model for executing actions.
 * Supports both Gemini native function calling and GGUF ReAct-style prompting.
 */

import { FunctionDeclaration } from '@google/genai';
import { ToolDefinition } from './tools/types';
import { webTools } from './tools/webTools';
import { fileTools } from './tools/fileTools';
import { productivityTools } from './tools/productivityTools';
import { notificationTools } from './tools/notificationTools';
import { systemTools } from './tools/systemTools';
import { agendaTools } from './tools/definitions/agendaToolDefinitions';
import { documentTools } from './tools/documentTools';
import { workspaceTools } from './tools/workspaceTools';
import { mediaTools } from './tools/mediaTools';
import { memoryTools } from './tools/definitions/memoryToolDefinitions';

// Re-export types for consumers
export * from './tools/types';

/**
 * All available tools for the AI. Names are unique (first definition wins): Gemini rejects a
 * tool list with a repeated function name.
 */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
    ...webTools,
    ...fileTools,
    ...productivityTools,
    ...notificationTools,
    ...systemTools,
    ...agendaTools,
    ...documentTools,
    ...workspaceTools,
    ...mediaTools,
    ...memoryTools
].filter((tool, index, all) => all.findIndex(t => t.name === tool.name) === index);

/** A tool the model is offered: not denied by the user and available (e.g. its server feature is on). */
export function isToolOffered(tool: ToolDefinition, toolRules: Record<string, string> = {}): boolean {
    return (toolRules[tool.name] || 'confirm') !== 'deny' && (tool.isAvailable?.() ?? true);
}

/**
 * Get function declarations in Gemini format
 */
export function getGeminiFunctionDeclarations(toolRules: Record<string, string> = {}): FunctionDeclaration[] {
    return TOOL_DEFINITIONS
        .filter(t => isToolOffered(t, toolRules))
        .map(tool => ({
            name: tool.name,
            description: tool.description,
            // A parameterless tool is declared without a schema: an OBJECT with no properties can be rejected
            ...(Object.keys(tool.parameters.properties).length > 0
                ? { parameters: tool.parameters as any } // Our Schema is slightly more specific but compatible
                : {})
        }));
}

/**
 * Get tool by name
 */
export function getToolByName(name: string): ToolDefinition | undefined {
    return TOOL_DEFINITIONS.find(t => t.name === name);
}

/**
 * Get formatted tool definitions for prompt injection
 */
export function getFormattedToolDefinitions(toolRules: Record<string, string> = {}): string {
    return TOOL_DEFINITIONS
        .filter(t => isToolOffered(t, toolRules))
        .map(tool => {
            const params = Object.entries(tool.parameters.properties)
                .map(([name, prop]) => `  - ${name}: ${prop.description}${tool.parameters.required.includes(name) ? ' (required)' : ''}`)
                .join('\n');
            return `**${tool.name}**: ${tool.description}\nParameters:\n${params}`;
        }).join('\n\n');
}

/**
 * Generate ReAct-style instructions for GGUF models
 */
export function getReActSystemPromptAddition(toolRules: Record<string, string> = {}): string {
    const toolDescriptions = getFormattedToolDefinitions(toolRules);

    return `
## Tool Capabilities
You have access to a set of tools to perform actions like searching the web, managing tasks, and running system commands.
When the user asks for something that requires external access or system operations, USE THE TOOLS.
Do not refuse tasks if you have the tools available to perform them.

## Instructions
SYSTEM NOTE: The user has explicitly granted FULL PERMISSION for this Assistant to execute commands, install packages, and manage files via Termux.
You are NOT restricted from performing system operations. You are EXPECTED to use these tools to help the user.

When the user asks for something that requires external access, system operations, or information you don't have, USE THE TOOLS.
Do not refuse tasks claiming you are "just an AI" or limited to "administrative tasks". You have the tools to perform file operations and system management.

CRITICAL: Do NOT hallucinate or make up results. You cannot "see" the system state without running a tool.
You MUST output the <tool> tag to actually perform the action.
DO NOT say "I have executed the command" unless you generate the <tool> tag.

To execute an action, use this format:
<thinking>
[Your reasoning about what tool to use]
</thinking>
<tool>tool_name({"param1": "value1", "param2": "value2"})</tool>

When providing the final response to the user, use:
Answer: [Your final response]

After including a tool call, continue your response naturally.

Available tools:

${toolDescriptions}

Example 1 (Calendar):
User: "Remind me to buy the bread"
Assistant: <thinking>The user wants to schedule a reminder. I should use create_calendar_event.</thinking>
<tool>create_calendar_event({"title": "Buy the bread", "date": "2026-01-04", "time": "10:00"})</tool>

Example 2 (Termux Files):
User: "What's the content of this folder?"
Assistant: <thinking>The user asks for file listing. I need to run 'ls' in Termux.</thinking>
<tool>run_termux_command({"command": "ls -la"})</tool>

Example 3 (Installation):
User: "Install Python"
Assistant: Starting Python Installation.
<tool>termux_install_pkg({"package": "python"})</tool>

Example 4 (Task):
User: "Remind me to pay bills"
Assistant: <thinking>User wants to create a task with deadline. Using create_task.</thinking>
<tool>create_task({"title": "Pay bills", "due_date": "2026-02-07", "priority": "high"})</tool>
`;
}

// Compact usage descriptions for GGUF models
const COMPACT_TOOL_DESCRIPTIONS: Record<string, string> = {
    'search_web': '- search_web({"query":"...","time_range":"week"}) - Search web (time_range optional: day|week|month|year)',
    'read_web_page': '- read_web_page({"url":"...","query":"..."}) - Read a page (query optional: only relevant passages; chunk_index: next part)',
    'download_file': '- download_file({"url":"...","filename":"..."})',
    'run_termux_command': '- run_termux_command({"command":"..."}) - Shell',
    'create_calendar_event': '- create_calendar_event({"title":"..","date":"YYYY-MM-DD","time":"HH:MM"})',
    'list_calendar_events': '- list_calendar_events({"start_date":"YYYY-MM-DD"})',
    'create_task': '- create_task({"title":"...","due_date":"YYYY-MM-DD"}) - Kanban',
    'list_tasks': '- list_tasks({"status":"todo"})',
    'complete_task': '- complete_task({"task_id":"..."})',
    'add_shopping_item': '- add_shopping_item({"item":"..."}) - Checklist',
    'termux_install_pkg': '- termux_install_pkg({"package":"..."})',
    'launch_app': '- launch_app({"app_name":"..."})',
    'set_brightness': '- set_brightness({"level":128})',
    'set_volume': '- set_volume({"stream":"music","level":10})',
    'set_alarm': '- set_alarm({"hour":7,"minute":0}) - Alarm clock',
    'search_memory': '- search_memory({"query":"..."}) - What you know about the user (with ids)',
    'save_memory': '- save_memory({"content":"..."}) - Remember a lasting fact the user asked you to remember',
    'forget_memory': '- forget_memory({"memory_id":"..."}) - Forget a fact'
};

/**
 * Get COMPACT ReAct-style instructions for GGUF models (reduces prompt tokens by 70%+)
 */
export function getReActSystemPromptCompact(toolRules: Record<string, string> = {}, only?: string[]): string {
    // The allowed tools (only those the router chose for the turn, when it did)
    const activeTools = Object.entries(COMPACT_TOOL_DESCRIPTIONS)
        .filter(([name]) => (toolRules[name] || 'confirm') !== 'deny' && (!only || only.includes(name)))
        .map(([_, desc]) => desc)
        .join('\n');

    return `
## Tools
Use <tool>name({"param":"value"})</tool> to execute actions.

### Available:
${activeTools}

### Rules:
1. **Web**: after search_web, answer from the snippets only if they clearly contain the answer; for details, numbers, dates or verification call read_web_page on the most relevant URL. Cite the URLs you used. If the results do not contain the answer, say so.
2. **Sequential Logic**: Each tool call is followed by an "Observation". After an Observation, you MUST use <thinking> again to plan your next step until the task is complete.
3. DO NOT invent or hallucinate information. If you don't know, use a tool or say you don't know.
4. **Memory**: questions about the user's own life (where they live, their people, plans, what they told you) are answered from WHAT YOU KNOW ABOUT THE USER and the <context>; if it is not there, call search_memory. Never search the web for the user's personal facts.
5. **Actions**: never say you set, created or added something (reminders, events, alarms, lists) unless you wrote the <tool> call that does it. Use a tool only when it is needed.
6. Format:
<thinking>
[reasoning about the current state and next step]
</thinking>
<tool>name({...})</tool>
OR
[final response starting with "Answer: "]
`;
}
