import { Type } from '@google/genai';
import { ToolDefinition } from './types';

export const productivityTools: ToolDefinition[] = [
    // Calendar
    {
        name: 'create_calendar_event',
        description: 'Creates a new event in the user\'s calendar. Use this when the user asks to schedule something, create a reminder, or add an appointment.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                title: {
                    type: Type.STRING,
                    description: 'The title or name of the event'
                },
                date: {
                    type: Type.STRING,
                    description: 'The date of the event in YYYY-MM-DD format'
                },
                time: {
                    type: Type.STRING,
                    description: 'The time of the event in HH:MM format (24-hour)'
                },
                duration_minutes: {
                    type: Type.NUMBER,
                    description: 'Duration of the event in minutes. Default is 60.'
                },
                notes: {
                    type: Type.STRING,
                    description: 'Optional notes or description for the event'
                }
            },
            required: ['title', 'date', 'time']
        },
        requiresConfirmation: true,
        category: 'calendar'
    },
    {
        name: 'list_calendar_events',
        description: 'Lists events from the user\'s calendar. Use when user asks what is on their schedule.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                start_date: {
                    type: Type.STRING,
                    description: 'Start date in YYYY-MM-DD format (optional, defaults to today)'
                },
                end_date: {
                    type: Type.STRING,
                    description: 'End date in YYYY-MM-DD format (optional, defaults to 7 days from start)'
                },
                duration_days: {
                    type: Type.NUMBER,
                    description: 'Number of days to list if end_date is not provided (default 7)'
                }
            },
            required: []
        },
        requiresConfirmation: false,
        category: 'calendar'
    },
    {
        name: 'create_note_keep',
        description: 'Creates a new note in Google Keep (or default note app). Use when user asks to note something down.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                title: {
                    type: Type.STRING,
                    description: 'Title of the note'
                },
                content: {
                    type: Type.STRING,
                    description: 'Body/Content of the note'
                }
            },
            required: ['content']
        },
        requiresConfirmation: true,
        category: 'calendar' // Grouping with productivity
    },

    // Shopping / Simple Checklist
    {
        name: 'add_shopping_item',
        description: 'Adds a simple item to a basic shopping list or scratchpad. Use ONLY for simple items like "buy milk", "bread", or quick reminders without deadlines.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                item: {
                    type: Type.STRING,
                    description: 'The item text'
                }
            },
            required: ['item']
        },
        requiresConfirmation: false,
        category: 'todo'
    },
    {
        name: 'complete_shopping_item',
        description: 'Marks a shopping/checklist item as found/done.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                item_text: {
                    type: Type.STRING,
                    description: 'Text of the item to mark as complete (partial match is fine)'
                }
            },
            required: ['item_text']
        },
        requiresConfirmation: false,
        category: 'todo'
    },
    {
        name: 'list_shopping_items',
        description: 'Lists active shopping/checklist items.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                include_completed: {
                    type: Type.BOOLEAN,
                    description: 'Whether to include completed items. Default is false.'
                }
            },
            required: []
        },
        requiresConfirmation: false,
        category: 'todo'
    }
];
