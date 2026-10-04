/**
 * Structured specification of a venture: what the MVP does, its public interface, the
 * acceptance criteria (AC-n) and the milestones that group them. The model writes JSON, the
 * code validates it and renders TECHNICAL_SPECIFICATION.md.
 */

export const VENTURE_TEMPLATES = ['node-library', 'node-api'] as const;
export type VentureTemplate = typeof VENTURE_TEMPLATES[number];

export interface SpecFeature { id: string; title: string; description: string }
export interface AcceptanceCriterion { id: string; feature: string; given: string; when: string; then: string }
export interface SpecMilestone { id: string; title: string; criteria: string[] }

export interface VentureSpec {
  audience: string;
  problem: string;
  mvpFeatures: SpecFeature[];
  outOfScope: string[];
  template: VentureTemplate;
  /** Functions (node-library) or HTTP routes of createServer() (node-api) the tests rely on. */
  publicInterface: string;
  acceptanceCriteria: AcceptanceCriterion[];
  milestones: SpecMilestone[];
}

export const SPEC_LIMITS = { features: 5, criteria: 15, milestones: 4 };

const AC_ID = /^AC-\d+$/;
const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Checks the model's JSON; returns the spec or the problems to send back for a retry. */
export function validateSpec(raw: any, options: { maxMilestones?: number } = {}): { spec?: VentureSpec; errors: string[] } {
  const errors: string[] = [];
  const maxMilestones = options.maxMilestones ?? SPEC_LIMITS.milestones;

  const mvpFeatures: SpecFeature[] = (Array.isArray(raw?.mvpFeatures) ? raw.mvpFeatures : [])
    .map((f: any, i: number) => ({ id: str(f?.id, 10) || `F${i + 1}`, title: str(f?.title, 120), description: str(f?.description) }))
    .filter((f: SpecFeature) => f.title);
  if (mvpFeatures.length === 0) errors.push('mvpFeatures must list at least one feature');
  if (mvpFeatures.length > SPEC_LIMITS.features) errors.push(`mvpFeatures must have at most ${SPEC_LIMITS.features} features`);

  const acceptanceCriteria: AcceptanceCriterion[] = (Array.isArray(raw?.acceptanceCriteria) ? raw.acceptanceCriteria : []).map((c: any) => ({
    id: str(c?.id, 10), feature: str(c?.feature, 10), given: str(c?.given, 500), when: str(c?.when, 500), then: str(c?.then, 500),
  }));
  if (acceptanceCriteria.length === 0) errors.push('acceptanceCriteria must not be empty');
  if (acceptanceCriteria.length > SPEC_LIMITS.criteria) errors.push(`acceptanceCriteria must have at most ${SPEC_LIMITS.criteria} criteria`);
  const ids = new Set<string>();
  for (const c of acceptanceCriteria) {
    if (!AC_ID.test(c.id)) errors.push(`criterion id "${c.id}" must look like AC-1`);
    if (ids.has(c.id)) errors.push(`criterion id ${c.id} is duplicated`);
    ids.add(c.id);
    if (!c.given || !c.when || !c.then) errors.push(`${c.id} needs given, when and then`);
  }

  const milestones: SpecMilestone[] = (Array.isArray(raw?.milestones) ? raw.milestones : []).map((m: any, i: number) => ({
    id: str(m?.id, 10) || `M${i + 1}`,
    title: str(m?.title, 160),
    criteria: (Array.isArray(m?.criteria) ? m.criteria : []).map((c: unknown) => str(c, 10)).filter(Boolean),
  }));
  if (milestones.length === 0) errors.push('milestones must not be empty');
  if (milestones.length > maxMilestones) errors.push(`milestones must be at most ${maxMilestones}`);
  const assigned = new Map<string, string>();
  for (const m of milestones) {
    if (!m.title) errors.push(`milestone ${m.id} needs a title`);
    if (m.criteria.length === 0) errors.push(`milestone ${m.id} lists no criterion`);
    for (const c of m.criteria) {
      if (!ids.has(c)) errors.push(`milestone ${m.id} refers to unknown criterion ${c}`);
      if (assigned.has(c)) errors.push(`${c} is in both ${assigned.get(c)} and ${m.id}`);
      assigned.set(c, m.id);
    }
  }
  for (const id of ids) if (!assigned.has(id)) errors.push(`${id} belongs to no milestone`);

  const publicInterface = str(raw?.publicInterface, 4000);
  if (!publicInterface) errors.push('publicInterface must describe the functions or routes the tests will use');

  const template: VentureTemplate = VENTURE_TEMPLATES.includes(raw?.template) ? raw.template : 'node-library';
  const spec: VentureSpec = {
    audience: str(raw?.audience),
    problem: str(raw?.problem),
    mvpFeatures,
    outOfScope: (Array.isArray(raw?.outOfScope) ? raw.outOfScope : []).map((s: unknown) => str(s, 300)).filter(Boolean).slice(0, 10),
    template,
    publicInterface,
    acceptanceCriteria,
    milestones,
  };
  return errors.length ? { errors } : { spec, errors };
}

export const TEMPLATE_CONTRACT: Record<VentureTemplate, string> = {
  'node-library': 'TypeScript library: the public functions are exported from src/index.ts (ES modules).',
  'node-api': 'TypeScript HTTP API on node:http without frameworks: src/server.ts exports createServer(): http.Server; src/index.ts only starts it on process.env.PORT.',
};

const SPEC_SCHEMA = `{
  "audience": "who uses it",
  "problem": "the problem in 1-3 sentences",
  "mvpFeatures": [{"id": "F1", "title": "...", "description": "..."}],
  "outOfScope": ["..."],
  "template": "node-library" or "node-api",
  "publicInterface": "exact signatures of the exported functions, or the HTTP routes with request/response shapes",
  "acceptanceCriteria": [{"id": "AC-1", "feature": "F1", "given": "...", "when": "...", "then": "..."}],
  "milestones": [{"id": "M1", "title": "...", "criteria": ["AC-1", "AC-2"]}]
}`;

export function specPrompt(input: { title: string; problem: string; summary: string; synthesis?: string | null; notes?: string | null; specialist?: string }): string {
  return `You are the product architect of a small software venture built by one AI coding agent.

Product: ${input.title}
Problem: ${input.problem}
Summary: ${input.summary}
Council recommendations: ${input.synthesis || 'N/A'}${input.notes ? `\nNotes from the owner: ${input.notes}` : ''}${input.specialist ?? ''}

Write the specification of a minimal but useful first version:
- at most ${SPEC_LIMITS.features} MVP features, and what stays out of scope;
- a template: ${VENTURE_TEMPLATES.map(t => `"${t}" (${TEMPLATE_CONTRACT[t]})`).join(' or ')};
- the public interface with exact names and signatures: acceptance tests are written against it before the code exists;
- at most ${SPEC_LIMITS.criteria} acceptance criteria, each testable automatically without network access;
- at most ${SPEC_LIMITS.milestones} milestones, in build order, that together cover every criterion exactly once.

Return ONLY a JSON object with this shape:
${SPEC_SCHEMA}`;
}

/** Prompt to add milestones to a delivered MVP (decision "continue"). */
export function extensionPrompt(title: string, current: VentureSpec, notes: string): string {
  const lastAc = Math.max(0, ...current.acceptanceCriteria.map(c => Number(c.id.slice(3)) || 0));
  return `You extend the specification of "${title}", whose MVP is delivered.

Current specification:
${JSON.stringify(current, null, 2)}

What the owner wants next:
${notes}

Add new acceptance criteria (ids from AC-${lastAc + 1}) and at most 3 new milestones that cover them. Keep the template.
You may extend publicInterface (keep what exists). Return ONLY a JSON object:
{"publicInterface": "the full interface after the change", "acceptanceCriteria": [new criteria only], "milestones": [new milestones only]}`;
}

export function renderSpecMarkdown(title: string, spec: VentureSpec): string {
  const criteria = (ids: string[]) => ids
    .map(id => spec.acceptanceCriteria.find(c => c.id === id))
    .filter((c): c is AcceptanceCriterion => !!c)
    .map(c => `- **${c.id}** (${c.feature}) — Given ${c.given}, when ${c.when}, then ${c.then}.`)
    .join('\n');
  return `# ${title} — Technical Specification

## Audience
${spec.audience || 'N/A'}

## Problem
${spec.problem || 'N/A'}

## MVP Features
${spec.mvpFeatures.map(f => `- **${f.id} ${f.title}**: ${f.description}`).join('\n')}

## Out of Scope
${spec.outOfScope.map(s => `- ${s}`).join('\n') || '- (nothing listed)'}

## Template
\`${spec.template}\`: ${TEMPLATE_CONTRACT[spec.template]}

## Public Interface
${spec.publicInterface}

## Milestones and Acceptance Criteria
${spec.milestones.map(m => `### ${m.id} — ${m.title}\n${criteria(m.criteria)}`).join('\n\n')}

## Acceptance Tests
The files in \`acceptance/\` (one per criterion, titles starting with \`[AC-n]\`) belong to the platform: they are
restored before every validation, changes to them are discarded.
`;
}
