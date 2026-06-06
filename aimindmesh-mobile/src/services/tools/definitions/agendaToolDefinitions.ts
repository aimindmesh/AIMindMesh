/**
 * Agenda Tool Definitions
 * Tools for managing internal calendar events and notes
 */

import { Type } from '@google/genai';
import { ToolDefinition } from '../types';

export const agendaTools: ToolDefinition[] = [
    {
        name: 'add_agenda_event',
        description: 'Adds a new event to the user\'s internal agenda/calendar. Use when user wants to schedule an appointment or event that should be remembered by the assistant.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                title: {
                    type: Type.STRING,
                    description: 'Title of the event'
                },
                date: {
                    type: Type.STRING,
                    description: 'Date in YYYY-MM-DD format'
                },
                start_time: {
                    type: Type.STRING,
                    description: 'Start time in HH:MM format (optional, defaults to 09:00 if not all-day)'
                },
                end_time: {
                    type: Type.STRING,
                    description: 'End time in HH:MM format (optional, defaults to 10:00 if not all-day)'
                },
                location: {
                    type: Type.STRING,
                    description: 'Location of the event (optional)'
                },
                notes: {
                    type: Type.STRING,
                    description: 'Additional notes for the event (optional)'
                },
                all_day: {
                    type: Type.BOOLEAN,
                    description: 'Whether this is an all-day event (optional, defaults to false)'
                }
            },
            required: ['title', 'date']
        },
        requiresConfirmation: true,
        category: 'agenda'
    },
    {
        name: 'add_agenda_note',
        description: 'Adds a note to the user\'s agenda for a specific date. Notes are free-form text that don\'t have a specific time. Use when user wants to remember something for a certain day.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                content: {
                    type: Type.STRING,
                    description: 'The content/text of the note'
                },
                date: {
                    type: Type.STRING,
                    description: 'Date for the note in YYYY-MM-DD format'
                },
                category: {
                    type: Type.STRING,
                    description: 'Category of the note (general, personal, work, shopping, idea)',
                    enum: ['general', 'personal', 'work', 'shopping', 'idea']
                }
            },
            required: ['content', 'date']
        },
        requiresConfirmation: true,
        category: 'agenda'
    },
    {
        name: 'delete_agenda_item',
        description: 'Deletes an event or note from the agenda by ID. Use when user explicitly asks to remove something from their calendar.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                id: {
                    type: Type.STRING,
                    description: 'The ID of the item to delete (starts with evt_ for events or note_ for notes)'
                },
                type: {
                    type: Type.STRING,
                    description: 'Type of item to delete',
                    enum: ['event', 'note']
                }
            },
            required: ['id', 'type']
        },
        requiresConfirmation: true,
        category: 'agenda'
    },
    {
        name: 'search_agenda',
        description: 'Searches the user\'s agenda for events and notes matching a query. Use when user asks about past or future events or notes.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                query: {
                    type: Type.STRING,
                    description: 'Search query to find matching events and notes'
                },
                limit: {
                    type: Type.NUMBER,
                    description: 'Maximum number of results to return (default 10)'
                }
            },
            required: ['query']
        },
        requiresConfirmation: false,
        category: 'agenda'
    },
    {
        name: 'list_agenda_day',
        description: 'Lists all events and notes for a specific day. Use when user asks what they have planned for a certain date.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                date: {
                    type: Type.STRING,
                    description: 'Date to list agenda for in YYYY-MM-DD format'
                }
            },
            required: ['date']
        },
        requiresConfirmation: false,
        category: 'agenda'
    },

    // ===========================================
    // TASK MANAGEMENT TOOLS
    // ===========================================

    {
        name: 'create_task',
        description: 'Creates a new task in the Kanban board. THIS IS THE PRIMARY TOOL FOR CREATING TASKS. Use for any to-do item that has a deadline, priority, or specific details.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                title: {
                    type: Type.STRING,
                    description: 'Title of the task'
                },
                description: {
                    type: Type.STRING,
                    description: 'Detailed description of the task (optional)'
                },
                due_date: {
                    type: Type.STRING,
                    description: 'Due date in YYYY-MM-DD format (optional, defaults to tomorrow)'
                },
                priority: {
                    type: Type.STRING,
                    description: 'Priority level',
                    enum: ['low', 'medium', 'high', 'urgent']
                },
                tags: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: 'Tags for categorization (e.g., ["work", "important"])'
                },
                estimated_hours: {
                    type: Type.NUMBER,
                    description: 'Estimated hours to complete (optional)'
                },
                pomodoro_target: {
                    type: Type.NUMBER,
                    description: 'Target number of 25-minute Pomodoro sessions (optional)'
                }
            },
            required: ['title']
        },
        requiresConfirmation: true,
        category: 'agenda'
    },
    {
        name: 'complete_task',
        description: 'Marks a task as completed. Use when user says they finished a task or want to mark something as done.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                task_id: {
                    type: Type.STRING,
                    description: 'ID of the task to complete (starts with task_)'
                }
            },
            required: ['task_id']
        },
        requiresConfirmation: true,
        category: 'agenda'
    },
    {
        name: 'list_tasks',
        description: 'Lists tasks from the user\'s Kanban board. Can filter by status, priority, or due date. Use when user asks about their tasks or to-do list.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                status: {
                    type: Type.STRING,
                    description: 'Filter by task status',
                    enum: ['backlog', 'todo', 'in-progress', 'review', 'done', 'all']
                },
                priority: {
                    type: Type.STRING,
                    description: 'Filter by priority',
                    enum: ['low', 'medium', 'high', 'urgent', 'all']
                },
                include_overdue: {
                    type: Type.BOOLEAN,
                    description: 'Include only overdue tasks (optional)'
                },
                days_ahead: {
                    type: Type.NUMBER,
                    description: 'Show tasks due within N days (optional)'
                }
            },
            required: []
        },
        requiresConfirmation: false,
        category: 'agenda'
    },
    {
        name: 'update_task_priority',
        description: 'Updates the priority of an existing task. Use when user wants to change how urgent a task is.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                task_id: {
                    type: Type.STRING,
                    description: 'ID of the task to update'
                },
                priority: {
                    type: Type.STRING,
                    description: 'New priority level',
                    enum: ['low', 'medium', 'high', 'urgent']
                }
            },
            required: ['task_id', 'priority']
        },
        requiresConfirmation: true,
        category: 'agenda'
    },
    {
        name: 'add_task_subtask',
        description: 'Adds a subtask (checklist item) to an existing task. Use when user wants to break down a task into smaller steps.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                parent_task_id: {
                    type: Type.STRING,
                    description: 'ID of the parent task'
                },
                title: {
                    type: Type.STRING,
                    description: 'Title of the subtask'
                }
            },
            required: ['parent_task_id', 'title']
        },
        requiresConfirmation: true,
        category: 'agenda'
    },
    {
        name: 'get_task_stats',
        description: 'Gets statistics about the user\'s tasks: total count, completion rate, overdue count, etc. Use when user asks about their productivity or task progress.',
        parameters: {
            type: Type.OBJECT,
            properties: {},
            required: []
        },
        requiresConfirmation: false,
        category: 'agenda'
    }
];
