/**
 * Memory Tool Implementations
 */

import { ToolResult, ToolExecutorContext } from './types';

export function executeSaveMemory(args: Record<string, unknown>, context: ToolExecutorContext): ToolResult {
    const content = args.content as string;
    const category = args.category as string || 'other';

    if (!content) {
        return { success: false, message: 'Memory content is required' };
    }

    context.addMemory(content, category);

    return {
        success: true,
        message: `Saved to memory: "${content}"`,
        data: { content, category }
    };
}
