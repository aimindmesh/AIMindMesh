import { CouncilMode, OrgRole, IdeaProposal } from './types';
import { RolePolicyService } from './RolePolicyService';
import { InferenceRouter } from '../InferenceRouter';

export class CouncilOrchestrator {
  constructor(
    private readonly policy: RolePolicyService,
  ) {}

  async reviewIdea(mode: CouncilMode, idea: IdeaProposal, roles: OrgRole[], humanFeedback?: string | null) {
    let history = '';
    const transcript: Array<{ role: string; content: string }> = [];

    // Loop through 3 rounds of discussion (dialectic debate)
    for (let round = 1; round <= 3; round++) {
      for (const role of roles) {
        let roundContextPrompt = '';
        if (round === 1) {
          roundContextPrompt = 'Provide your initial professional feedback, support, or primary concerns for this idea.';
        } else if (round === 2) {
          roundContextPrompt = 'Review the initial feedback from Round 1. Explicitly challenge, validate, or refine specific arguments or concerns raised by other council members.';
        } else {
          roundContextPrompt = 'Formulate your final stance (Approve or Reject) on this idea, summarizing any critical requirements or conditions that must be met.';
        }

        let humanFeedbackSection = '';
        if (humanFeedback) {
          humanFeedbackSection = `\n\n[HUMAN OPERATOR INTERVENTION]\nThe human operator has integrated the following ideas/feedback:\n${humanFeedback}\nYou MUST address this feedback directly from your role's perspective, incorporating or countering it in your arguments.`;
        }

        const prompt = `You are participating in an AI Council strategic debate as the role: ${role.name}.
Mission: ${role.mission}
Description: ${role.description}
System Prompt: ${role.systemPrompt}

Current Mode: ${mode}
Idea Topic: ${idea.title}
Problem Statement: ${idea.problemStatement}
Idea Summary: ${idea.summary}${humanFeedbackSection}

Discussion History:
${history || '(The debate has just started)'}

[ROUND ${round} INSTRUCTIONS]
${roundContextPrompt}
Limit your response to 3-5 sentences. Maintain your professional persona strictly.
Always respond in English.`;

        const response = await InferenceRouter.complete(prompt, 'DEBATE_PARTICIPATION', {
          taskName: `Council debate: ${role.name} (Round ${round})`
        });

        transcript.push({ role: role.name, content: response });
        history += `\n\n[Round ${round}] ${role.name}: ${response}`;
      }
    }

    // Run final synthesis/consensus round
    let synthesisHumanFeedbackSection = '';
    if (humanFeedback) {
      synthesisHumanFeedbackSection = `\n\n[HUMAN OPERATOR INTERVENTION]\nThe human operator has integrated the following ideas/feedback:\n${humanFeedback}\nEnsure your synthesis covers how the council addressed this feedback and whether it is resolved in the recommendations.`;
    }

    const synthesisPrompt = `You are the Council Orchestrator. Read the following multi-agent dialectic debate transcript regarding the idea "${idea.title}".
Problem Statement: ${idea.problemStatement}
Idea Summary: ${idea.summary}${synthesisHumanFeedbackSection}

Transcript:
${history}

Your task is to summarize the debate and determine if the council reached consensus to approve the idea.
Provide a structured Markdown report containing:
1. **Summary of Discussion**: A synthesis of the main discussion points.
2. **Primary Tensions & Conflicts**: Disagreements between roles during the debate.
3. **Key Actionable Recommendations**: Recommendations and conditions required before proceeding.
4. **Consensus Verdict**: State clearly "Consensus: Yes" or "Consensus: No" based on the final round.
Always respond in English.`;

    const synthesis = await InferenceRouter.complete(synthesisPrompt, 'DEBATE_SUMMARY', {
      taskName: 'Council debate synthesis'
    });

    const lowerSynthesis = synthesis.toLowerCase();
    
    const hasYes = /\b(consensus|approve|approval|consensus to approve)\b.*?\b(yes|true)\b/si.test(lowerSynthesis) ||
                   lowerSynthesis.includes('consensus: yes') ||
                   lowerSynthesis.includes('approve: yes');
                   
    const hasNo = /\b(consensus|approve|approval|consensus to approve)\b.*?\b(no|false|rejected|pause)\b/si.test(lowerSynthesis) || 
                  lowerSynthesis.includes('consensus: no') ||
                  lowerSynthesis.includes('approve: no') ||
                  lowerSynthesis.includes('no consensus') ||
                  /\*\*no\.\*\*/.test(lowerSynthesis);

    const consensus = hasYes && !hasNo;

    return {
      synthesis,
      consensus,
      transcript
    };
  }
}

