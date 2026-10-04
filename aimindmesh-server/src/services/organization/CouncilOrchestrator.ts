import { CouncilMode, OrgRole, IdeaProposal } from './types';
import { RolePolicyService } from './RolePolicyService';
import { InferenceRouter } from '../InferenceRouter';
import { Parser } from '../../utils/Parser';
import { config } from '../../config';

export interface CouncilVote {
  role: string;
  vote: 'approve' | 'reject' | 'invalid';
  confidence: number;
  conditions: string[];
}

export interface CouncilResult {
  synthesis: string;
  consensus: boolean;
  transcript: Array<{ role: string; content: string }>;
  votes: CouncilVote[];
}

// The Director is the human operator and the Meeting Analyst works on transcripts: neither votes on ideas
const NON_VOTING = new Set(['director', 'meeting analyst']);
const DEFAULT_ROLES = ['Researcher', 'Developer', 'Reviewer', 'Security', 'QA'];
const DEFAULT_MAX_PARTICIPANTS = 6;
const DEFAULT_ROUNDS = 2;
const MIN_VALID_VOTES = 3;

function councilSettings() {
  const council = config.organization?.council;
  return {
    roles: council?.roles?.length ? council.roles : DEFAULT_ROLES,
    maxParticipants: Math.min(10, Math.max(3, council?.maxParticipants ?? DEFAULT_MAX_PARTICIPANTS)),
    rounds: Math.min(3, Math.max(1, council?.rounds ?? DEFAULT_ROUNDS)),
  };
}

/** Preferred roles first (in their order), then other voting roles, up to the participant limit. */
export function selectParticipants(roles: OrgRole[], preferred: string[], max: number): OrgRole[] {
  const voting = roles.filter(r => r.status === 'active' && !NON_VOTING.has(r.name.toLowerCase()));
  const rank = (r: OrgRole) => {
    const i = preferred.findIndex(p => p.toLowerCase() === r.name.toLowerCase());
    return i === -1 ? preferred.length : i;
  };
  return [...voting].sort((a, b) => rank(a) - rank(b)).slice(0, max);
}

export function parseVote(role: string, raw: string): CouncilVote {
  try {
    const json = Parser.parseLLMJson(raw);
    const vote = String(json?.vote ?? '').toLowerCase();
    if (vote !== 'approve' && vote !== 'reject') throw new Error('no vote');
    const confidence = Math.min(1, Math.max(0, Number(json.confidence) || 0));
    const conditions = Array.isArray(json.conditions) ? json.conditions.filter((c: unknown) => typeof c === 'string').slice(0, 8) : [];
    return { role, vote, confidence, conditions };
  } catch {
    return { role, vote: 'invalid', confidence: 0, conditions: [] };
  }
}

/** Approved when at least two thirds of the valid votes approve, with at least three valid votes. */
export function tallyVotes(votes: CouncilVote[]): { consensus: boolean; approvals: number; rejections: number; invalid: number } {
  const approvals = votes.filter(v => v.vote === 'approve').length;
  const rejections = votes.filter(v => v.vote === 'reject').length;
  const valid = approvals + rejections;
  return {
    consensus: valid >= MIN_VALID_VOTES && approvals >= Math.ceil((2 * valid) / 3),
    approvals,
    rejections,
    invalid: votes.length - valid,
  };
}

function argumentOf(raw: string): string {
  try {
    const json = Parser.parseLLMJson(raw);
    if (typeof json?.argument === 'string') return json.argument;
  } catch {
    // not JSON: show the text as written
  }
  return raw;
}

/**
 * The council debates an idea and votes. The verdict comes from the structured votes of the
 * last round, never from the wording of the synthesis.
 */
export class CouncilOrchestrator {
  constructor(
    private readonly policy: RolePolicyService,
  ) {}

  async reviewIdea(mode: CouncilMode, idea: IdeaProposal, roles: OrgRole[], humanFeedback?: string | null): Promise<CouncilResult> {
    const settings = councilSettings();
    const participants = selectParticipants(roles, settings.roles, settings.maxParticipants);
    const transcript: Array<{ role: string; content: string }> = [];
    const votes: CouncilVote[] = [];
    let previousRound = '';

    const feedback = humanFeedback
      ? `\n\n[HUMAN OPERATOR INTERVENTION]\nThe human operator added this feedback:\n${humanFeedback}\nAddress it directly from your role's perspective.`
      : '';

    for (let round = 1; round <= settings.rounds; round++) {
      const final = round === settings.rounds;
      let thisRound = '';
      for (const role of participants) {
        const instructions = final
          ? `Give your final stance. Respond ONLY with a JSON object with exactly these keys:
{"vote": "approve" or "reject", "confidence": number between 0 and 1, "conditions": [requirements that must hold before building], "argument": "2-4 sentences explaining your vote"}`
          : 'Give your professional assessment: support, concerns and what would change your mind. 3-5 sentences.';

        const prompt = `You are participating in an AI Council review as the role: ${role.name}.
Mission: ${role.mission}
Description: ${role.description}
System Prompt: ${role.systemPrompt}

Current Mode: ${mode}
Idea: ${idea.title}
Problem Statement: ${idea.problemStatement}
Summary: ${idea.summary}${feedback}

${previousRound ? `Previous round:\n${previousRound}` : '(First round: no previous discussion.)'}

[ROUND ${round} OF ${settings.rounds}]
${instructions}
Always respond in English.`;

        const response = await InferenceRouter.complete(prompt, 'DEBATE_PARTICIPATION', {
          taskName: `Council debate: ${role.name} (Round ${round})`
        });

        if (final) votes.push(parseVote(role.name, response));
        const shown = final ? argumentOf(response) : response;
        transcript.push({ role: role.name, content: shown });
        thisRound += `\n\n${role.name}: ${shown}`;
      }
      previousRound = thisRound;
    }

    const tally = tallyVotes(votes);
    const voteLines = votes.map(v => `- ${v.role}: ${v.vote}${v.conditions.length ? ` (conditions: ${v.conditions.join('; ')})` : ''}`).join('\n');

    const synthesisPrompt = `You are the Council Orchestrator. Summarize this council review of the idea "${idea.title}".
Problem Statement: ${idea.problemStatement}
Idea Summary: ${idea.summary}${feedback}

Final round:
${previousRound}

Votes:
${voteLines}

The verdict is already decided by the votes: ${tally.consensus ? 'APPROVED' : 'NOT APPROVED'}.
Write a structured Markdown report with:
1. **Summary of Discussion**
2. **Primary Tensions & Conflicts**
3. **Key Actionable Recommendations**: the conditions required before building
Do not restate or change the verdict. Always respond in English.`;

    const summary = await InferenceRouter.complete(synthesisPrompt, 'DEBATE_SUMMARY', {
      taskName: 'Council debate synthesis'
    });

    const verdict = `**Consensus: ${tally.consensus ? 'Yes' : 'No'}** (${tally.approvals} approve, ${tally.rejections} reject${tally.invalid ? `, ${tally.invalid} invalid` : ''})`;
    return {
      synthesis: `${summary.trim()}\n\n4. ${verdict}\n${voteLines}`,
      consensus: tally.consensus,
      transcript,
      votes,
    };
  }
}
