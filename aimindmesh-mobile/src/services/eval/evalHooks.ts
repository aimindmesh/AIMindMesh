/**
 * Overrides used only by the on-device eval harness (deviceEval.ts, test builds): the scenario's
 * past-conversation memories instead of the user's, no workspace documents, and a copy of each
 * prompt and raw output. Empty in normal use.
 */
export interface EvalHooks {
    memories?: Array<{ content: string; role: string; timestamp?: number }>;
    noWorkspace?: boolean;
    capture?: (prompt: string, output: string) => void;
}

export const evalHooks: EvalHooks = {};
