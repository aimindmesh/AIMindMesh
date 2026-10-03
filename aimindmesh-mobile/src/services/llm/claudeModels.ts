/** Default when no model is chosen: the one the settings screen shows as selected */
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-5';

/** Model to request: Claude 3.x ids (e.g. the old 'claude-3-5-sonnet-latest' default) are retired */
export function resolveClaudeModel(model?: string): string {
    return !model || model.startsWith('claude-3') ? DEFAULT_CLAUDE_MODEL : model;
}
