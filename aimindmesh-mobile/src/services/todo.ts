import { TodoItem } from './todoTypes';

export interface TodoCommandResult {
    type: 'add' | 'complete' | 'list' | 'none';
    task?: string;
    taskId?: string;
    response?: string;
}

/**
 * Extract todo commands from AI response or user message
 * Supports Italian and English - SIMPLIFIED for better detection
 */
export const extractTodoCommand = (text: string, currentTodos: TodoItem[]): TodoCommandResult => {
    const lowerText = text.toLowerCase();

    // List tasks command
    const listKeywords = ['quali sono', 'lista', 'mostrami', 'elenca', 'cose da fare', 'task', 'todo', 'what are my', 'list my', 'show me'];
    if (listKeywords.some(keyword => lowerText.includes(keyword) && (lowerText.includes('task') || lowerText.includes('cose') || lowerText.includes('fare') || lowerText.includes('todo')))) {
        const activeTodos = currentTodos.filter(t => !t.completedAt);
        if (activeTodos.length === 0) {
            return {
                type: 'list',
                response: 'You have no tasks at the moment!'
            };
        }
        const taskList = activeTodos.map((t, i) => `${i + 1}. ${t.text}`).join('\\n');
        return {
            type: 'list',
            response: `Here are your tasks:\\n${taskList}`
        };
    }

    // Complete task command - check for completion keywords
    const completeKeywords = ['ho fatto', 'ho completato', 'completato', 'fatto', 'finito', 'done', 'completed', 'finished'];
    const hasCompleteKeyword = completeKeywords.some(keyword => lowerText.includes(keyword));

    if (hasCompleteKeyword) {
        // Try to find the task by matching text
        const taskText = text
            .toLowerCase()
            .replace(/ho (fatto|completato|finito)/gi, '')
            .replace(/(fatto|completato|finito|done|completed|finished)/gi, '')
            .replace(/\b(il|la|i|le|un|una|the|a)\b/gi, '')
            .trim();

        if (taskText) {
            // Find matching task
            const activeTodos = currentTodos.filter(t => !t.completedAt);
            const matchingTask = activeTodos.find(t =>
                t.text.toLowerCase().includes(taskText) ||
                taskText.includes(t.text.toLowerCase())
            );

            if (matchingTask) {
                return {
                    type: 'complete',
                    taskId: matchingTask.id,
                    response: `Perfect! I've marked "${matchingTask.text}" as completed. 🎉`
                };
            }
        }
    }

    // Add task command - SIMPLIFIED
    const addKeywords = ['aggiungi', 'crea', 'nuova', 'nuovo task', 'new task', 'add task', 'add to', 'todo'];
    const hasAddKeyword = addKeywords.some(keyword => lowerText.includes(keyword));

    // Simplified: just check for "remember" keyword
    const hasRememberKeyword = lowerText.includes('ricorda') || lowerText.includes('remember');
    const hasTimePattern = /\b(today|tomorrow|in|at|hour|the \d|january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}[:\\/\-\.]\d{1,2})\b/i.test(text);

    if (hasAddKeyword || (hasRememberKeyword && !hasTimePattern)) {
        // Extract task description - more aggressive cleaning
        let taskText = text;

        // Remove command keywords more thoroughly
        taskText = taskText
            .replace(/\b(aggiungi|crea|nuova|nuovo|new|add|todo|task|ricordami|ricorda|ricordati)\b/gi, '')
            .replace(/\b(che|di|devo|:|il|la|i|le|un|una|that|to|the|a|alla|lista|list)\b/gi, '')
            .trim();

        if (taskText && taskText.length > 2) {
            return {
                type: 'add',
                task: taskText,
                response: `I've added "${taskText}" to your task list! ✓`
            };
        }
    }

    return { type: 'none' };
};
