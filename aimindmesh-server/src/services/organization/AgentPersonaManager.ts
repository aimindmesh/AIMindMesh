import { OrgRole, Directive } from './types';

export class AgentPersonaManager {
  generateSystemPrompt(
    role: OrgRole,
    directives: Directive[],
    taskContext?: string,
    memorySummary?: string
  ): string {
    let prompt = `You are playing the role of ${role.name} in our autonomous AI organization.
Your description: ${role.description}
Your core mission: ${role.mission}

Core system instructions:
${role.systemPrompt}

Current Active Strategic Directives to follow:
`;

    if (directives.length === 0) {
      prompt += `- Maintain normal operations and pursue general optimization.\n`;
    } else {
      directives.forEach(d => {
        prompt += `- [${d.goalType.toUpperCase()}] ${d.title}: ${d.description}\n`;
      });
    }

    if (taskContext) {
      prompt += `\nCurrent task context:\n${taskContext}\n`;
    }

    if (memorySummary) {
      prompt += `\nRelevant organizational memory summary:\n${memorySummary}\n`;
    }

    prompt += `\nPermissions & Guardrails:
Allowed permissions: ${role.toolPermissions.join(', ') || 'None'}.
You must always respect the organizational hierarchy, seek human approval for privileged actions (such as repo creation, recruitment, or provisioning validation), and act safely.`;

    return prompt;
  }
}
