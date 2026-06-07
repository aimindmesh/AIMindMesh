import { randomUUID } from 'crypto';
import db from '../../db/sqlite';
import { Logger } from '../../utils/Logger';
import { Parser } from '../../utils/Parser';
import { InferenceRouter } from '../InferenceRouter';
import { SQLiteOrganizationRoleRepository } from './OrganizationRegistry';
import { OrgRole } from './types';

export class DesignOrchestrator {
  public static async characterizeIdea(ideaId: string): Promise<void> {
    try {
      Logger.info('DesignOrchestrator', `Starting characterization for idea: ${ideaId}`);

      const ideaRow = db.prepare('SELECT * FROM organization_ideas WHERE id = ?').get(ideaId) as any;
      if (!ideaRow) {
        Logger.warn('DesignOrchestrator', `Idea ${ideaId} not found.`);
        return;
      }

      // 1. HR Assessment: Do we need a new specialized role?
      const roleRepo = new SQLiteOrganizationRoleRepository();
      const activeRoles = await roleRepo.list();
      const roleNames = activeRoles.map(r => r.name).join(', ');

      const hrPrompt = `You are the HR Director. We are building the following product:
Title: ${ideaRow.title}
Problem: ${ideaRow.problem_statement}
Summary: ${ideaRow.summary}

Our current active roles are: ${roleNames}.
Does this project require a highly specialized AI role that we do not have? (e.g., "Unreal Engine Rendering Expert" or "Quantitative Finance Logic Designer").
Respond with ONLY a JSON object. If yes, provide the details. If no, set "needsRole" to false.
{
  "needsRole": true,
  "candidateRoleName": "...",
  "businessNeed": "...",
  "suggestedMission": "...",
  "suggestedPrompt": "..."
}`;

      let specializedPromptAddition = '';
      try {
        const hrResponse = await InferenceRouter.complete(hrPrompt, 'AGENTIC_TASK', {
          taskName: `HR Assessment for ${ideaRow.title}`
        });
        
        const hrData = Parser.parseLLMJson(hrResponse);
        if (hrData.needsRole && hrData.candidateRoleName) {
          Logger.info('DesignOrchestrator', `Recruiting new specialized role: ${hrData.candidateRoleName}`);
          const newRole: OrgRole = {
            id: randomUUID(),
            name: hrData.candidateRoleName,
            description: hrData.businessNeed,
            mission: hrData.suggestedMission,
            systemPrompt: hrData.suggestedPrompt,
            providerPreferences: {},
            toolPermissions: [],
            memoryNamespace: 'general',
            status: 'active',
            approvalPolicy: { autoApprove: true },
            canRecruit: false,
            canProposeRepo: false,
            canProvisionValidation: false,
            createdBy: 'system:design-orchestrator',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          await roleRepo.insert(newRole);
          specializedPromptAddition = `\nWe have recruited a specialized role: ${newRole.name}. Their mission: ${newRole.mission}. Consider their perspective in your design.`;
        }
      } catch (hrErr: any) {
        Logger.warn('DesignOrchestrator', `HR Assessment failed, continuing without new roles: ${hrErr.message}`);
      }

      // 2. Technical & Product Design Generation
      const designPrompt = `You are an elite team comprising a Software Architect, UI/UX Designer, and Product Manager.
You are tasked with generating a comprehensive TECHNICAL_SPECIFICATION.md for the following approved venture idea:

Title: ${ideaRow.title}
Problem: ${ideaRow.problem_statement}
Summary: ${ideaRow.summary}
Debate Synthesis: ${ideaRow.analysis_synthesis || 'N/A'}${specializedPromptAddition}

Generate a strictly structured JSON response containing the product design details. Do not include markdown wraps around the JSON.
{
  "scopeAndAudience": "Define the exact scope, target audience, and primary use cases.",
  "uiUxDesign": "Detail the interface, layouts, color palettes, and user flows.",
  "coreLogic": "Describe the core business logic, mechanics, and algorithms.",
  "techStack": "List the recommended frontend, backend, and infrastructure technologies.",
  "rawMarkdown": "The full, complete TECHNICAL_SPECIFICATION.md content combining all the above sections."
}`;

      const designResponse = await InferenceRouter.complete(designPrompt, 'AGENTIC_TASK', {
        taskName: `Product Design for ${ideaRow.title}`
      });

      const designData = Parser.parseLLMJson(designResponse);

      // 3. Save to Database
      const designId = randomUUID();
      db.prepare(`
        INSERT INTO organization_product_designs (
          id, idea_id, scope_and_audience, ui_ux_design, core_logic, tech_stack, raw_markdown, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        designId,
        ideaId,
        designData.scopeAndAudience || 'N/A',
        designData.uiUxDesign || 'N/A',
        designData.coreLogic || 'N/A',
        designData.techStack || 'N/A',
        designData.rawMarkdown || 'N/A',
        new Date().toISOString(),
        new Date().toISOString()
      );

      // 4. Update Idea Status
      db.prepare("UPDATE organization_ideas SET status = 'characterized', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), ideaId);

      Logger.info('DesignOrchestrator', `Successfully characterized idea: ${ideaRow.title}`);

      // 5. Trigger Development Phase
      const { VentureOrchestrator } = await import('./VentureOrchestrator');
      await VentureOrchestrator.onIdeaCharacterized(ideaId);

    } catch (err: any) {
      Logger.error('DesignOrchestrator', `Characterization failed for idea ${ideaId}: ${err.message}`);
      throw err;
    }
  }
}
