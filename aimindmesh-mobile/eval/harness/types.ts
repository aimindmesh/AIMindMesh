/** Scenario files (eval/scenarios/*.json) */

export type Category = 'recall' | 'tools' | 'extraction' | 'hygiene';

export interface ScenarioFact {
    content: string;
    kind?: string;
    importance?: number;
    subject?: string;
    /** Due date relative to now, in days */
    dueInDays?: number;
}

export interface ScenarioTurn { role: 'user' | 'model'; text: string; minutesAgo?: number }

export interface Expectation {
    /** tools: expected tool name (or any of several), or null for "no tool" */
    tool?: string | Array<string | null> | null;
    /** "Ricordati che…": a fact matching this regex must be saved (inline tag or save_memory) */
    remembers?: string;
    /** tools: argument name → regexes that must all match its value */
    args?: Record<string, string[]>;
    /** Answer: every regex must match */
    mustInclude?: string[];
    /** Answer: at least one regex must match */
    anyOf?: string[];
    /** Answer: no regex may match */
    mustNotInclude?: string[];
    /** Answer language */
    lang?: 'it' | 'en';
    /** extraction: facts that must be saved (regex on content), optionally with kind and due day offset */
    facts?: Array<{ match: string; kind?: string; dueInDays?: number | 'none'; dueWeekday?: number }>;
    /** extraction: nothing may be saved */
    noFacts?: boolean;
}

export interface Scenario {
    id: string;
    category: Category;
    /** Smoke subset for fast iterations */
    smoke?: boolean;
    note?: string;
    facts?: ScenarioFact[];
    /** Past-conversation memories returned by the episodic retriever */
    memories?: string[];
    history?: ScenarioTurn[];
    /** Results the tools return in this scenario (by tool name) */
    toolResults?: Record<string, string>;
    /** The user message of the turn (chat categories) */
    user?: string;
    /** extraction: the conversation to read */
    conversation?: ScenarioTurn[];
    expect: Expectation;
}
