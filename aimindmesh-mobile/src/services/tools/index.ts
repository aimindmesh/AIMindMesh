/**
 * Tool Executor Service
 * 
 * Central orchestration for tool execution.
 * Individual tool implementations are in separate modules.
 */

import { logger } from '../logger';
import { getToolByName } from '../toolDefinitions';

// Import and re-export types
export type { ToolCall, ToolResult, ToolConfirmationMode, ToolExecutorContext } from './types';
import { ToolCall, ToolResult, ToolConfirmationMode, ToolExecutorContext } from './types';


// Import tool implementations
import { executeCreateCalendarEvent, executeListCalendarEvents } from './calendarTools';
import { executeAddTodo, executeCompleteTodo, executeListTodos } from './todoTools';
import { executeSaveMemory } from './memoryTools';
import { executeScheduleNotification } from './notificationTools';
import { executeSearchFiles, executeCreateTextFile, executeDownloadFile } from './fileTools';
import { executeReadWebPage, executeSearchWeb, executeOpenBrowser, executeSearchMaps, executeAnalyzeWeb } from './webTools';
import {
    executeRunTermuxCommand,
    executeGetClipboard,
    executeSetClipboard,
    executeGetBatteryStatus,
    executeTermuxSpeak,
    executeTermuxNotification,
    executeTermuxVibrate,
    installTermuxPackage,
    installTermuxUbuntu
} from './systemTools';
import { executeSetVolume, executeSetBrightness, executeToggleWifi, executeGetLocation } from './deviceTools';
import { executeSendWhatsApp, executeSendTelegram, executeGetContacts } from './communicationTools';
import { executeRecordAudio, executeTakePhoto } from './mediaTools';
import { executeLaunchApp, executeCreateKeepNote, executeSetAlarm } from './appTools';
import {
    executeAddAgendaEvent,
    executeAddAgendaNote,
    executeDeleteAgendaItem,
    executeSearchAgenda,
    executeListAgendaDay
} from './agendaTools';
import {
    executeCreateTask,
    executeCompleteTask,
    executeListTasks,
    executeUpdateTaskPriority,
    executeAddTaskSubtask,
    executeGetTaskStats
} from './taskTools';

/**
 * Check if a tool requires user confirmation
 */
export function needsConfirmation(
    toolName: string,
    confirmationMode: ToolConfirmationMode,
    rememberedPermissions: Record<string, boolean>,
    toolRules: Record<string, 'allow' | 'confirm' | 'deny'> = {}
): boolean {
    const rule = toolRules[toolName];
    if (rule === 'allow') return false;
    if (rule === 'confirm') return true;
    if (rule === 'deny') return true; // Halt execution for denied tools (user can reject in modal)

    // Check if user has already made a remembered choice (Legacy support)
    if (rememberedPermissions[toolName] !== undefined) {
        return !rememberedPermissions[toolName];
    }

    if (confirmationMode === 'never') return false;
    if (confirmationMode === 'always') return true;

    // 'dangerous' mode - only confirm for tools that modify state
    const tool = getToolByName(toolName);
    return tool?.requiresConfirmation ?? true;
}

/**
 * Execute a tool call and return the result
 */
export async function executeTool(
    call: ToolCall,
    context: ToolExecutorContext
): Promise<ToolResult> {
    logger.log('info', `Executing tool: ${call.name}`, call.args);

    try {
        switch (call.name) {
            case 'create_calendar_event':
                return await executeCreateCalendarEvent(call.args as any);

            case 'list_calendar_events':
                return await executeListCalendarEvents(call.args as any);

            case 'add_shopping_item':
                return executeAddTodo(call.args as any, context);

            case 'complete_shopping_item':
                return executeCompleteTodo(call.args as any, context);

            case 'list_shopping_items':
                return executeListTodos(call.args as any, context);

            case 'schedule_notification':
                return await executeScheduleNotification(call.args as any);

            case 'save_memory':
                return executeSaveMemory(call.args as any, context);

            case 'search_files':
                return await executeSearchFiles(call.args as any);

            case 'create_text_file':
                return await executeCreateTextFile(call.args as any);

            case 'run_termux_command':
                return await executeRunTermuxCommand(call.args as any);

            case 'read_web': // Alias for model robustness
            case 'read_web_page':
                return await executeReadWebPage(call.args as any);

            case 'get_clipboard':
                return await executeGetClipboard();

            case 'set_clipboard':
                return await executeSetClipboard(call.args as any);

            case 'get_battery_status':
                return await executeGetBatteryStatus();

            case 'termux_speak':
                return await executeTermuxSpeak(call.args as any);

            case 'termux_notification':
                return await executeTermuxNotification(call.args as any);

            case 'termux_vibrate':
                return await executeTermuxVibrate(call.args as any);

            case "termux_install_pkg":
                return await installTermuxPackage(call.args as any);
            case "termux_install_ubuntu":
                return await installTermuxUbuntu();

            case 'create_note_keep':
                return await executeCreateKeepNote(call.args as any);

            case 'set_alarm':
                return await executeSetAlarm(call.args as any);

            case 'take_photo':
                return await executeTakePhoto(call.args as any);

            case 'search_web':
                return await executeSearchWeb(call.args as any);

            case 'analyze_web':
                return await executeAnalyzeWeb(call.args as any);

            case 'download_file':
                return await executeDownloadFile(call.args as any);

            case 'launch_app':
                return await executeLaunchApp(call.args as any);

            case 'search_maps':
                return await executeSearchMaps(call.args as any);

            case 'open_browser':
                return await executeOpenBrowser(call.args as any);

            case 'send_whatsapp':
                return await executeSendWhatsApp(call.args as any);

            case 'send_telegram':
                return await executeSendTelegram(call.args as any);

            case 'get_contacts':
                return await executeGetContacts(call.args as any);

            case 'record_audio':
                return await executeRecordAudio(call.args as any);

            case 'set_volume':
                return await executeSetVolume(call.args as any);

            case 'set_brightness':
                return await executeSetBrightness(call.args as any);

            case 'toggle_wifi':
                return await executeToggleWifi(call.args as any);

            case 'get_location':
                return await executeGetLocation(call.args as any);

            // Agenda Tools
            case 'add_agenda_event':
                return await executeAddAgendaEvent(call.args as any);

            case 'add_agenda_note':
                return await executeAddAgendaNote(call.args as any);

            case 'delete_agenda_item':
                return await executeDeleteAgendaItem(call.args as any);

            case 'search_agenda':
                return await executeSearchAgenda(call.args as any);

            case 'list_agenda_day':
                return await executeListAgendaDay(call.args as any);

            // Task Management Tools
            case 'create_task':
                return await executeCreateTask(call.args as any);

            case 'complete_task':
                return await executeCompleteTask(call.args as any);

            case 'list_tasks':
                return await executeListTasks(call.args as any);

            case 'update_task_priority':
                return await executeUpdateTaskPriority(call.args as any);

            case 'add_task_subtask':
                return await executeAddTaskSubtask(call.args as any);

            case 'get_task_stats':
                return await executeGetTaskStats();

            default:
                return {
                    success: false,
                    message: `Unknown tool: ${call.name}`
                };
        }
    } catch (error) {
        logger.log('error', `Tool execution failed: ${call.name}`, error);
        // Explicitly log for Logcat visibility
        console.error(`[ToolError] Execution of ${call.name} failed:`, error);
        if (error instanceof Error) {
            console.error(`[ToolError] Stack:`, error.stack);
        }

        return {
            success: false,
            message: `Error executing ${call.name}: ${(error as Error).message}`
        };
    }
}

/**
 * Parse ReAct-style tool calls from text
 * Returns the tool calls found and the cleaned text (without tool tags)
 */
export function parseReActToolCalls(text: string): { calls: ToolCall[]; cleanedText: string } {
    // Support both [tool]f({...})[/tool] and legacy <tool>...
    // Also handle truncated calls at the very end of the string.
    // Fixed: Require the closing parenthesis before the end tag so it doesn't get captured in argsStr.
    const toolPattern = /(?:\[|<)tool(?:\]|>)(\w+)\s*\(([\s\S]*?)\)\s*(?:(?:\[|<)\/tool(?:\]|>)|$)/g;
    const calls: ToolCall[] = [];
    let cleanedText = text;

    let match;
    while ((match = toolPattern.exec(text)) !== null) {
        // If match[0] is empty (can happen with |$ if not careful?), skip. 
        // But our regex requires <tool> at start, so it won't be empty.

        const name = match[1];
        let argsStr = match[2];

        // Cleanup incomplete closing tags from the args if the regex swallowed them or stopped at $
        // E.g. found "args...</"
        argsStr = argsStr.replace(/<\/?$/, '').trim();

        let args: Record<string, unknown> = {};

        try {
            if (argsStr) {
                // Extra safety: strip any lingering trailing parenthesis if the regex somehow missed it
                let cleanArgs = argsStr.replace(/\)\s*$/, '').trim();

                args = JSON.parse(cleanArgs);
            }
        } catch (e) {
            // Attempt simple repair for common trailing comma or missing brace
            try {
                // Fix common "trailing comma" issue: , } -> }
                const fixedArgs = argsStr.replace(/,\s*}/, '}').replace(/,\s*$/, '');
                if (fixedArgs !== argsStr) {
                    args = JSON.parse(fixedArgs);
                } else {
                    throw e;
                }
            } catch (e2) {
                logger.log('warn', `Failed to parse tool args for ${name}:`, argsStr);
                console.error(`[ToolError] Failed to parse args for ${name}`, argsStr, e);
                continue;
            }
        }

        calls.push({ name, args });
        cleanedText = cleanedText.replace(match[0], '');
    }



    if (calls.length > 0) {
        console.log(`[ToolParser] Found ${calls.length} tools:`, calls.map(c => c.name));
    }

    return { calls, cleanedText: cleanedText.trim() };
}

/**
 * Format tool result for feeding back to the model
 */
export function formatToolResultForModel(call: ToolCall, result: ToolResult): string {
    return `[Tool ${call.name} result: ${result.success ? 'Success' : 'Failed'} - ${result.message}]`;
}
