/**
 * Facts: what the assistant knows about the user, one statement each. They replace the
 * manual memory list and the 'extracted' rows of the episodic table. A fact is never
 * merged away: an update supersedes it (the old one stays as history).
 */

export const FACT_KINDS = [
    'identity',   // who the user is: name, job, where they live
    'person',     // people in the user's life
    'preference', // likes, dislikes, how they want to be helped
    'goal',       // what they want to achieve
    'project',    // what they are working on
    'routine',    // habits and recurring things
    'commitment', // something the user has to do (open loop)
    'event',      // something that will happen on a date (open loop)
    'other',
] as const;

export type FactKind = typeof FACT_KINDS[number];
/** 'review': stored before the fact gate and refused by it now; out of the prompt until the user decides */
export type FactStatus = 'active' | 'done' | 'superseded' | 'expired' | 'review';
export type FactSource = 'manual' | 'extracted' | 'inline' | 'tool' | 'imported' | 'migrated';

export interface Fact {
    id: string;
    kind: FactKind;
    /** Who the fact is about when it is not the user (e.g. "Giulia") */
    subject?: string;
    /** One statement, in the user's language */
    content: string;
    /** User-defined label (the memory categories of the settings) */
    category?: string;
    /** 1 (trivia) .. 5 (core to who the user is) */
    importance: number;
    /** 0..1: 1 when the user said or confirmed it */
    confidence: number;
    source: FactSource;
    sourceThread?: string;
    createdAt: number;
    updatedAt: number;
    /** Date of a commitment or event (ms) */
    dueAt?: number;
    status: FactStatus;
    /** Fact that replaced this one */
    supersededBy?: string;
    /** Always part of the profile */
    pinned: boolean;
    lastUsedAt?: number;
    useCount: number;
}

/** Fields given when a fact is created; the store fills in the rest */
export type NewFact = Pick<Fact, 'content'> & Partial<Omit<Fact, 'content' | 'createdAt' | 'updatedAt' | 'useCount'>>;

export const KIND_LABELS: Record<FactKind, string> = {
    identity: 'About you',
    person: 'People',
    preference: 'Preferences',
    goal: 'Goals',
    project: 'Projects',
    routine: 'Routines',
    commitment: 'To do',
    event: 'Upcoming',
    other: 'Other',
};

export const MIN_IMPORTANCE = 1;
export const MAX_IMPORTANCE = 5;
export const MAX_FACT_LENGTH = 400;

export function isFactKind(value: unknown): value is FactKind {
    return typeof value === 'string' && (FACT_KINDS as readonly string[]).includes(value);
}

export function clampImportance(value: unknown, fallback = 3): number {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? Math.min(MAX_IMPORTANCE, Math.max(MIN_IMPORTANCE, Math.round(n))) : fallback;
}

/** Commitments and events still ahead or not done: the "open loops" followed up on */
export function isOpenLoop(fact: Fact): boolean {
    return (fact.kind === 'commitment' || fact.kind === 'event') && fact.status === 'active';
}

/** Kind of a memory saved with one of the old categories (manual list, extraction, backups) */
export function kindFromCategory(category: string | undefined | null): FactKind {
    const c = (category || '').trim().toLowerCase();
    if (isFactKind(c)) return c;
    if (['personal', 'personale', 'identity'].includes(c)) return 'identity';
    if (['preferences', 'preferenze', 'likes'].includes(c)) return 'preference';
    if (['relationship', 'relationships', 'family', 'famiglia', 'people'].includes(c)) return 'person';
    if (['work', 'lavoro', 'projects'].includes(c)) return 'project';
    if (['goals', 'obiettivi'].includes(c)) return 'goal';
    if (['tasks', 'todo'].includes(c)) return 'commitment';
    if (['dates', 'events'].includes(c)) return 'event';
    return 'other';
}

/** Text compared for duplicates: case, spacing and final punctuation do not matter */
export function normalizeFactText(text: string): string {
    return text.toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').replace(/[.!?;,\s]+$/, '').trim();
}
