import { Message } from '../../types';
import { ConversationThread, ThreadMetadata, Category } from '../../types/conversationThread';

const STORAGE_KEY = 'conversation-threads';
const CATEGORY_STORAGE_KEY = 'conversation-categories';
const ACTIVE_THREAD_KEY = 'active-thread-id';

/**
 * Generate a title from the first user message
 */
export function generateThreadTitle(messages: Message[]): string {
    const firstUserMessage = messages.find(m => m.role === 'user');

    if (!firstUserMessage) {
        return 'New Conversation';
    }

    // Take first 50 characters or up to first line break
    const text = firstUserMessage.text.split('\n')[0];
    const title = text.length > 50 ? text.substring(0, 47) + '...' : text;

    return title || 'New Conversation';
}

/**
 * Generate a preview from the first user message
 */
function generatePreview(messages: Message[]): string {
    const firstUserMessage = messages.find(m => m.role === 'user');

    if (!firstUserMessage) {
        return 'No messages yet';
    }

    const text = firstUserMessage.text;
    return text.length > 100 ? text.substring(0, 97) + '...' : text;
}

/**
 * Load all threads from localStorage
 */
export function loadThreads(): ConversationThread[] {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return [];

        const threads = JSON.parse(stored);

        // Convert date strings back to Date objects
        return threads.map((thread: any) => ({
            ...thread,
            createdAt: new Date(thread.createdAt),
            updatedAt: new Date(thread.updatedAt),
            messages: thread.messages.map((msg: any) => ({
                ...msg,
                timestamp: new Date(msg.timestamp)
            }))
        }));
    } catch (error) {
        console.error('Failed to load threads:', error);
        return [];
    }
}

/**
 * Save all threads to localStorage
 */
function saveThreads(threads: ConversationThread[]): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
    } catch (error) {
        console.error('Failed to save threads:', error);
    }
}

/**
 * Create a new thread from messages
 */
export function createThread(messages: Message[]): ConversationThread {
    const now = new Date();

    return {
        id: now.getTime().toString(),
        title: generateThreadTitle(messages),
        createdAt: now,
        updatedAt: now,
        messages: messages,
        preview: generatePreview(messages)
    };
}

/**
 * Save or update a thread
 */
export function saveThread(thread: ConversationThread): void {
    const threads = loadThreads();
    const existingIndex = threads.findIndex(t => t.id === thread.id);

    const updatedThread = {
        ...thread,
        updatedAt: new Date(),
        preview: generatePreview(thread.messages)
    };

    if (existingIndex >= 0) {
        threads[existingIndex] = updatedThread;
    } else {
        threads.push(updatedThread);
    }

    saveThreads(threads);
}

/**
 * Load a specific thread by ID
 */
export function loadThread(id: string): ConversationThread | null {
    const threads = loadThreads();
    return threads.find(t => t.id === id) || null;
}

/**
 * Delete a thread by ID
 */
export function deleteThread(id: string): void {
    const threads = loadThreads();
    const filtered = threads.filter(t => t.id !== id);
    saveThreads(filtered);

    // If deleted thread was active, clear active thread
    if (getActiveThreadId() === id) {
        clearActiveThreadId();
    }
}

/**
 * Get all thread metadata (for list view)
 */
export function getThreadMetadata(): ThreadMetadata[] {
    const threads = loadThreads();

    // Sort by updatedAt descending (most recent first)
    const sorted = threads.sort((a, b) =>
        b.updatedAt.getTime() - a.updatedAt.getTime()
    );

    return sorted.map(thread => ({
        id: thread.id,
        title: thread.title,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        preview: thread.preview,
        messageCount: thread.messages.length,
        categoryId: thread.categoryId
    }));
}

/**
 * Get the active thread ID
 */
export function getActiveThreadId(): string | null {
    return localStorage.getItem(ACTIVE_THREAD_KEY);
}

/**
 * Set the active thread ID
 */
export function setActiveThreadId(id: string): void {
    localStorage.setItem(ACTIVE_THREAD_KEY, id);
}

/**
 * Clear the active thread ID
 */
export function clearActiveThreadId(): void {
    localStorage.removeItem(ACTIVE_THREAD_KEY);
}

/**
 * Update thread title
 */
export function updateThreadTitle(id: string, newTitle: string): void {
    const threads = loadThreads();
    const thread = threads.find(t => t.id === id);

    if (thread) {
        thread.title = newTitle;
        thread.updatedAt = new Date();
        saveThreads(threads);
    }
}

/**
 * Update thread category
 */
export function updateThreadCategory(id: string, categoryId: string | undefined): void {
    const threads = loadThreads();
    const thread = threads.find(t => t.id === id);

    if (thread) {
        thread.categoryId = categoryId;
        thread.updatedAt = new Date();
        saveThreads(threads);
    }
}

/**
 * Load all categories
 */
export function loadCategories(): Category[] {
    try {
        const stored = localStorage.getItem(CATEGORY_STORAGE_KEY);
        if (!stored) return [];
        return JSON.parse(stored);
    } catch (error) {
        console.error('Failed to load categories:', error);
        return [];
    }
}

/**
 * Save categories
 */
function saveCategories(categories: Category[]): void {
    try {
        localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(categories));
    } catch (error) {
        console.error('Failed to save categories:', error);
    }
}

/**
 * Save or update a category
 */
export function saveCategory(category: Category): void {
    const categories = loadCategories();
    const existingIndex = categories.findIndex(c => c.id === category.id);

    if (existingIndex >= 0) {
        categories[existingIndex] = category;
    } else {
        categories.push(category);
    }

    saveCategories(categories);
}

/**
 * Delete a category
 */
export function deleteCategory(id: string): void {
    const categories = loadCategories();
    const filtered = categories.filter(c => c.id !== id);
    saveCategories(filtered);

    // Remove category from threads
    const threads = loadThreads();
    let threadsChanged = false;
    threads.forEach(t => {
        if (t.categoryId === id) {
            t.categoryId = undefined;
            threadsChanged = true;
        }
    });
    if (threadsChanged) {
        saveThreads(threads);
    }
}

/**
 * Export data
 */
export function exportData(): string {
    const threads = loadThreads();
    const categories = loadCategories();
    return JSON.stringify({ threads, categories }, null, 2);
}

/**
 * Import data
 */
export function importData(jsonData: string): boolean {
    try {
        const data = JSON.parse(jsonData);
        if (!data.threads && !data.categories) return false;

        const currentThreads = loadThreads();
        const currentCategories = loadCategories();

        // Merge threads (avoid duplicates by ID)
        if (Array.isArray(data.threads)) {
            data.threads.forEach((newThread: any) => {
                if (!currentThreads.some(t => t.id === newThread.id)) {
                    // Ensure dates are converted
                    currentThreads.push({
                        ...newThread,
                        createdAt: new Date(newThread.createdAt),
                        updatedAt: new Date(newThread.updatedAt),
                        messages: newThread.messages.map((msg: any) => ({
                            ...msg,
                            timestamp: new Date(msg.timestamp)
                        }))
                    });
                }
            });
            saveThreads(currentThreads);
        }

        // Merge categories
        if (Array.isArray(data.categories)) {
            data.categories.forEach((newCat: Category) => {
                if (!currentCategories.some(c => c.id === newCat.id)) {
                    currentCategories.push(newCat);
                }
            });
            saveCategories(currentCategories);
        }

        return true;
    } catch (error) {
        console.error('Import failed:', error);
        return false;
    }
}
