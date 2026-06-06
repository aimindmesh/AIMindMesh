/**
 * Todo Tool Implementations
 */

import { ToolResult, ToolExecutorContext } from './types';

export function executeAddTodo(args: Record<string, unknown>, context: ToolExecutorContext): ToolResult {
    const item = args.item as string;

    if (!item) {
        return { success: false, message: 'Item text is required' };
    }

    context.addTodo(item);

    return {
        success: true,
        message: `Added "${item}" to your shopping/checklist`,
        data: { item }
    };
}

export function executeCompleteTodo(args: Record<string, unknown>, context: ToolExecutorContext): ToolResult {
    const itemText = (args.item_text as string)?.toLowerCase();

    // Find matching incomplete task
    const matchingTask = context.todos.find((t: any) =>
        !t.completedAt && t.text.toLowerCase().includes(itemText)
    );

    if (!matchingTask) {
        return {
            success: false,
            message: `Could not find an active item matching "${itemText}"`
        };
    }

    context.completeTodo(matchingTask.id);

    return {
        success: true,
        message: `Marked "${matchingTask.text}" as found/done`,
        data: { item: matchingTask.text }
    };
}

export function executeListTodos(args: Record<string, unknown>, context: ToolExecutorContext): ToolResult {
    const includeCompleted = args.include_completed as boolean || false;

    const items = context.todos.filter((t: any) =>
        includeCompleted || !t.completedAt
    );

    if (items.length === 0) {
        return {
            success: true,
            message: 'No items found in your checklist',
            data: { items: [] }
        };
    }

    const itemList = items.map((t: any, i: number) =>
        `${i + 1}. ${t.text}${t.completedAt ? ' ✓' : ''}`
    );

    return {
        success: true,
        message: `You have ${items.length} item(s):\n${itemList.join('\n')}`,
        data: { items: items.map((t: any) => ({ text: t.text, completed: !!t.completedAt })) }
    };
}
