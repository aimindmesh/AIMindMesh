import { randomUUID } from 'crypto';
import { RoleCreationProposal } from './types';
import db from '../../db/sqlite';
import { InferenceRouter } from '../InferenceRouter';

export class HRRecruitmentService {
  async analyzeAndProposeRole(): Promise<RoleCreationProposal> {
    const roles = db.prepare("SELECT name, mission, description FROM organization_roles WHERE status = 'active'").all() as any[];
    const directives = db.prepare("SELECT title, description FROM organization_directives WHERE status = 'active'").all() as any[];
    const ideas = db.prepare("SELECT title, problem_statement, summary FROM organization_ideas").all() as any[];
    const existingProposals = db.prepare("SELECT candidate_role_name FROM organization_role_proposals").all() as any[];

    const rolesList = roles.map(r => `- ${r.name}: ${r.mission}`).join('\n');
    const directivesList = directives.map(d => `- ${d.title}: ${d.description}`).join('\n');
    const ideasList = ideas.map(i => `- ${i.title}: ${i.summary}`).join('\n');
    const proposalsList = existingProposals.map(p => p.candidate_role_name).join(', ');

    const prompt = `You are the HR Director agent for the AIMindMesh organization.
Your task is to analyze the current organization's active roles, strategic directives, and active venture ideas to identify a critical missing role/persona that would help execute the directives and develop the venture ideas.

IMPORTANT: Do NOT propose any role that duplicates or overlaps significantly with the existing active roles or existing proposals.
Existing active roles:
${rolesList || '(None)'}

Existing pending proposals:
${proposalsList || '(None)'}

Strategic Directives:
${directivesList || '(None)'}

Active Venture Ideas:
${ideasList || '(None)'}

Output your response strictly as a JSON object containing the following keys (do not include markdown wrapping other than json):
{
  "candidateRoleName": "Exact name of the proposed role",
  "businessNeed": "Brief explanation of the workflow gap or business need this role addresses",
  "suggestedMission": "Clear mission statement of the role",
  "suggestedPrompt": "System prompt instructing the LLM agent on how to play this role, its persona constraints and how it should interact during council debates",
  "requiredPermissions": ["gitea:read", "web:search"],
  "confidence": 0.85,
  "sourceSignals": ["Workflow analysis gap detected"]
}
Ensure the suggested role is highly detailed, professional, and has a very rich and robust suggestedPrompt. Output valid JSON only.`;

    const responseText = await InferenceRouter.complete(prompt, 'AGENTIC_TASK', {
      taskName: 'Analyze organization recruitment needs'
    });

    let data: any;
    try {
      const match = responseText.match(/\{[\s\S]*\}/);
      data = JSON.parse(match ? match[0] : responseText);
    } catch (e) {
      data = {
        candidateRoleName: 'Developer Relations Specialist',
        businessNeed: 'Advocate and support integrations for developed repositories.',
        suggestedMission: 'Bridge the developer community with AIMindMesh evolution projects.',
        suggestedPrompt: 'You are the Developer Relations Specialist. You bridge the developers and stakeholders, ensuring smooth integration.',
        requiredPermissions: ['gitea:read'],
        confidence: 0.85,
        sourceSignals: ['Workflow analysis gap detected']
      };
    }

    return {
      id: randomUUID(),
      candidateRoleName: data.candidateRoleName || 'Developer Relations Specialist',
      businessNeed: data.businessNeed || 'Advocate and support integrations.',
      suggestedMission: data.suggestedMission || 'Bridge developer relations.',
      suggestedPrompt: data.suggestedPrompt || 'You are Developer Relations Specialist.',
      requiredPermissions: Array.isArray(data.requiredPermissions) ? data.requiredPermissions : ['gitea:read'],
      confidence: typeof data.confidence === 'number' ? data.confidence : 0.85,
      sourceSignals: Array.isArray(data.sourceSignals) ? data.sourceSignals : ['Workflow analysis gap detected'],
      status: 'proposed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}
