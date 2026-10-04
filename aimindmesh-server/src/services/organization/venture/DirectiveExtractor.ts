import db from '../../../db/sqlite';
import { InferenceRouter } from '../../InferenceRouter';
import { Parser } from '../../../utils/Parser';
import { DirectiveService, SQLiteDirectiveRepository } from '../DirectiveService';
import type { Directive, DirectiveGoalType } from '../../../types/api';

const MAX_DIRECTIVES = 8;

export const councilDirectiveTag = (ideaId: string) => `system:council-debate:${ideaId}`;

export function hasIdeaDirectives(ideaId: string): boolean {
  return !!db.prepare('SELECT 1 FROM organization_directives WHERE idea_id = ? LIMIT 1').get(ideaId);
}

const PROMPT = (title: string, problem: string, synthesis: string) => `You turn the recommendations of a product council into directives for the team building "${title}".
Problem statement: ${problem}

Council synthesis:
${synthesis}

Extract the actionable recommendations and conditions as directives for THIS product only.
Return ONLY a JSON array (at most ${MAX_DIRECTIVES} elements). Each element has exactly these keys:
- "title": short title (max 60 characters)
- "description": what to explore, build, improve or check
- "goalType": one of "explore", "build", "improve", "stop", "pivot", "research"
- "priority": integer between 1 and 100
- "constraints": object of string values (may be empty)`;

/**
 * Directives derived from a council synthesis. They are scoped to their idea: they guide the
 * agent building that idea and never become topics of the organization-wide discovery.
 */
export async function extractDirectivesFromSynthesis(idea: { id: string; title: string; problem_statement?: string | null }, synthesis: string): Promise<Directive[]> {
  const response = await InferenceRouter.complete(PROMPT(idea.title, idea.problem_statement || '', synthesis), 'DIRECTIVES_EXTRACTION', {
    taskName: `Extracting directives for: ${idea.title}`,
  });
  const items = Parser.parseLLMJsonArray(response);
  if (items.length === 0) throw new Error('The model did not return any directive');

  const service = new DirectiveService(new SQLiteDirectiveRepository());
  const created: Directive[] = [];
  for (const item of items.slice(0, MAX_DIRECTIVES)) {
    const title = typeof item?.title === 'string' ? item.title.trim().slice(0, 120) : '';
    const description = typeof item?.description === 'string' ? item.description.trim().slice(0, 2000) : '';
    if (!title || !description) continue;
    const goalType: DirectiveGoalType = DirectiveService.validateGoalType(item.goalType) ? item.goalType : 'research';
    const priority = Math.min(100, Math.max(1, Math.round(Number(item.priority) || 50)));
    const constraints = item.constraints && typeof item.constraints === 'object' && !Array.isArray(item.constraints) ? item.constraints : {};
    created.push(await service.createDirective({
      title, description, goalType, priority, constraints,
      createdBy: councilDirectiveTag(idea.id),
      ideaId: idea.id,
    }));
  }
  return created;
}
