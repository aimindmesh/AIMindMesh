/**
 * Build a prompt for AI-based memory categorization
 */
export const buildCategorizationPrompt = (
    memoryContent: string,
    availableCategories: string[]
): string => {
    return `Categorize this memory into ONE of these categories: ${availableCategories.join(', ')}

Memory: "${memoryContent}"

Respond with ONLY the category name, nothing else. Choose the most appropriate category.`;
};
