/**
 * Memory Tool Definitions
 * What the assistant knows about the user: save, look up, correct and forget facts.
 */

import { Type } from '@google/genai';
import { ToolDefinition } from '../types';
import { FACT_KINDS } from '../../memory/facts/factTypes';

export const memoryTools: ToolDefinition[] = [
    {
        name: 'save_memory',
        description: 'Remembers a lasting fact about the user (who they are, people in their life, preferences, goals, projects, routines, things to do, dates). Write it as one short sentence in the user\'s language. Do not save what is already known.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                content: { type: Type.STRING, description: 'The fact, one short sentence' },
                kind: { type: Type.STRING, description: `One of: ${FACT_KINDS.join(', ')}` },
                importance: { type: Type.NUMBER, description: '1 (trivia) to 5 (core to who the user is)' },
                due_date: { type: Type.STRING, description: 'YYYY-MM-DD, for a commitment or an event' },
                about: { type: Type.STRING, description: 'Name of the person the fact is about, if not the user' },
            },
            required: ['content'],
        },
        requiresConfirmation: false,
        category: 'memory',
    },
    {
        name: 'search_memory',
        description: 'Looks up what you know about the user on a topic. Returns facts with their ids (needed to update or forget them).',
        parameters: {
            type: Type.OBJECT,
            properties: {
                query: { type: Type.STRING, description: 'Topic or words to look for' },
            },
            required: ['query'],
        },
        requiresConfirmation: false,
        category: 'memory',
    },
    {
        name: 'update_memory',
        description: 'Replaces a fact that changed or was wrong (the old version is kept as history). Get the id with search_memory.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                memory_id: { type: Type.STRING, description: 'Id of the fact' },
                content: { type: Type.STRING, description: 'The fact as it is now' },
            },
            required: ['memory_id', 'content'],
        },
        requiresConfirmation: false,
        category: 'memory',
    },
    {
        name: 'forget_memory',
        description: 'Deletes a fact the user asks you to forget. Get the id with search_memory.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                memory_id: { type: Type.STRING, description: 'Id of the fact' },
            },
            required: ['memory_id'],
        },
        requiresConfirmation: true,
        category: 'memory',
    },
];
