import { Message } from '../types';

export interface ConversationThread {
    id: string;
    title: string;
    createdAt: Date;
    updatedAt: Date;
    messages: Message[];
    preview: string; // Preview text from first user message
    categoryId?: string;
}

export interface ThreadMetadata {
    id: string;
    title: string;
    createdAt: Date;
    updatedAt: Date;
    preview: string;
    messageCount: number;
    categoryId?: string;
}

export interface Category {
    id: string;
    name: string;
    color?: string;
}
