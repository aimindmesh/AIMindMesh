import { randomUUID } from 'crypto';
import db from '../../db/sqlite';
import { Logger } from '../../utils/Logger';
import { Parser } from '../../utils/Parser';
import { InferenceRouter } from '../InferenceRouter';
import { SQLiteOrganizationRoleRepository } from './OrganizationRegistry';
import { OrgRole } from './types';
import { config } from '../../config';
import { extensionPrompt, renderSpecMarkdown, specPrompt, validateSpec, VentureSpec } from './venture/VentureSpec';
import { generateAcceptanceTests } from './venture/VentureScaffold';
import { createMilestones, deleteMilestones, loadDesign } from './venture/Milestones';

export class DesignOrchestrator {
  public static async characterizeIdea(ideaId: string): Promise<void> {
    try {
      Logger.info('DesignOrchestrator', `Starting characterization for idea: ${ideaId}`);

      const ideaRow = db.prepare('SELECT * FROM organization_ideas WHERE id = ?').get(ideaId) as any;
      if (!ideaRow) {
        Logger.warn('DesignOrchestrator', `Idea ${ideaId} not found.`);
        return;
      }

      // An idea is characterized once: approving it again (or a retry) reuses the design
      const existingDesign = db.prepare('SELECT id FROM organization_product_designs WHERE idea_id = ?').get(ideaId);
      if (existingDesign) {
        Logger.info('DesignOrchestrator', `Idea ${ideaId} already has a design: going on with provisioning`);
        const { VentureOrchestrator } = await import('./VentureOrchestrator');
        await VentureOrchestrator.onIdeaCharacterized(ideaId);
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
        const hrResponse = await InferenceRouter.complete(hrPrompt, 'ORGANIZATION_DESIGN', {
          taskName: `HR Assessment for ${ideaRow.title}`
        });
        
        const hrData = Parser.parseLLMJson(hrResponse);
        if (hrData.needsRole && typeof hrData.candidateRoleName === 'string' && hrData.candidateRoleName.trim()) {
          const roleName = hrData.candidateRoleName.trim().slice(0, 80);
          if (config.organization?.allowAutoRoleMaterialization === true) {
            Logger.info('DesignOrchestrator', `Recruiting new specialized role: ${roleName}`);
            const newRole: OrgRole = {
              id: randomUUID(),
              name: roleName,
              description: String(hrData.businessNeed ?? ''),
              mission: String(hrData.suggestedMission ?? ''),
              systemPrompt: String(hrData.suggestedPrompt ?? ''),
              providerPreferences: {},
              toolPermissions: [],
              memoryNamespace: 'general',
              status: 'active',
              approvalPolicy: {},
              canRecruit: false,
              canProposeRepo: false,
              canProvisionValidation: false,
              createdBy: 'system:design-orchestrator',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            if (!(await roleRepo.findByName(roleName))) await roleRepo.insert(newRole);
          } else {
            // A proposal for the HR panel: it joins the council only when a human materializes it
            const now = new Date().toISOString();
            db.prepare(`
              INSERT INTO organization_role_proposals
                (id, candidate_role_name, business_need, suggested_mission, suggested_prompt, required_permissions, confidence, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, '[]', 0.5, 'proposed', ?, ?)
            `).run(randomUUID(), roleName, String(hrData.businessNeed ?? ''), String(hrData.suggestedMission ?? ''), String(hrData.suggestedPrompt ?? ''), now, now);
            Logger.info('DesignOrchestrator', `Proposed specialized role for HR review: ${roleName}`);
          }
          specializedPromptAddition = `\nA specialist role is relevant: ${roleName}. Their mission: ${String(hrData.suggestedMission ?? '')}. Consider that perspective in your design.`;
        }
      } catch (hrErr: any) {
        Logger.warn('DesignOrchestrator', `HR Assessment failed, continuing without new roles: ${hrErr.message}`);
      }

      // 2. Structured specification (validated, one retry with the problems found)
      const spec = await DesignOrchestrator.generateSpec(specPrompt({
        title: ideaRow.title,
        problem: ideaRow.problem_statement,
        summary: ideaRow.summary,
        synthesis: ideaRow.analysis_synthesis,
        notes: ideaRow.outcome_notes || ideaRow.human_feedback,
        specialist: specializedPromptAddition,
      }), ideaRow.title);

      // 3. Server-owned acceptance tests, written before the code
      const acceptance = await generateAcceptanceTests(ideaRow.title, spec, spec.acceptanceCriteria.map(c => c.id));

      // 4. Save design and milestones
      const now = new Date().toISOString();
      db.transaction(() => {
        db.prepare(`
          INSERT INTO organization_product_designs (
            id, idea_id, scope_and_audience, ui_ux_design, core_logic, tech_stack, raw_markdown, spec_json, acceptance_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          randomUUID(), ideaId,
          [spec.audience, ...spec.mvpFeatures.map(f => `${f.id} ${f.title}: ${f.description}`)].join('\n'),
          spec.publicInterface,
          spec.acceptanceCriteria.map(c => `${c.id}: Given ${c.given}, when ${c.when}, then ${c.then}`).join('\n'),
          spec.template,
          renderSpecMarkdown(ideaRow.title, spec),
          JSON.stringify(spec), JSON.stringify(acceptance), now, now,
        );
        deleteMilestones(ideaId);
        createMilestones(ideaId, spec.milestones);
        db.prepare("UPDATE organization_ideas SET status = 'characterized', updated_at = ? WHERE id = ?").run(now, ideaId);
      })();

      Logger.info('DesignOrchestrator', `Characterized "${ideaRow.title}": ${spec.acceptanceCriteria.length} criteria in ${spec.milestones.length} milestones`);

      // 5. Provisioning and first development run
      const { VentureOrchestrator } = await import('./VentureOrchestrator');
      await VentureOrchestrator.onIdeaCharacterized(ideaId);

    } catch (err: any) {
      Logger.error('DesignOrchestrator', `Characterization failed for idea ${ideaId}: ${err.message}`);
      throw err;
    }
  }

  /** Asks for the spec, validates it, and retries once with the problems found. */
  private static async generateSpec(prompt: string, title: string, maxMilestones?: number): Promise<VentureSpec> {
    let errors: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const fullPrompt = errors.length
        ? `${prompt}\n\nYour previous answer was rejected:\n${errors.map(e => `- ${e}`).join('\n')}\nFix these problems.`
        : prompt;
      const response = await InferenceRouter.complete(fullPrompt, 'ORGANIZATION_DESIGN', { taskName: `Product Design for ${title}` });
      let raw: unknown;
      try {
        raw = Parser.parseLLMJson(response);
      } catch {
        errors = ['the answer was not a JSON object'];
        continue;
      }
      const result = validateSpec(raw, { maxMilestones });
      if (result.spec) return result.spec;
      errors = result.errors.slice(0, 15);
    }
    throw new Error(`No valid specification: ${errors.join('; ')}`);
  }

  /**
   * Decision "continue" on a delivered MVP: new criteria and milestones from the owner's notes,
   * with their acceptance tests. The repository then resumes from the first new milestone.
   */
  public static async extendSpec(ideaId: string, notes: string): Promise<void> {
    const ideaRow = db.prepare('SELECT * FROM organization_ideas WHERE id = ?').get(ideaId) as any;
    const design = loadDesign(ideaId);
    if (!ideaRow || !design) throw new Error('The idea has no structured specification to extend');

    const raw = Parser.parseLLMJson(await InferenceRouter.complete(extensionPrompt(ideaRow.title, design.spec, notes), 'ORGANIZATION_DESIGN', {
      taskName: `Extend specification: ${ideaRow.title}`,
    }));
    const merged = validateSpec({
      ...design.spec,
      publicInterface: typeof raw?.publicInterface === 'string' && raw.publicInterface.trim() ? raw.publicInterface : design.spec.publicInterface,
      acceptanceCriteria: [...design.spec.acceptanceCriteria, ...(Array.isArray(raw?.acceptanceCriteria) ? raw.acceptanceCriteria : [])],
      milestones: [...design.spec.milestones, ...(Array.isArray(raw?.milestones) ? raw.milestones.slice(0, 3) : [])],
    }, { maxMilestones: design.spec.milestones.length + 3 });
    if (!merged.spec) throw new Error(`Invalid extension: ${merged.errors.join('; ')}`);
    const spec = merged.spec;
    const added = spec.milestones.slice(design.spec.milestones.length);
    if (added.length === 0) throw new Error('The extension adds no milestone');

    const acceptance = { ...design.acceptance, ...await generateAcceptanceTests(ideaRow.title, spec, added.flatMap(m => m.criteria)) };
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(`UPDATE organization_product_designs SET spec_json = ?, acceptance_json = ?, raw_markdown = ?, updated_at = ? WHERE idea_id = ?`)
        .run(JSON.stringify(spec), JSON.stringify(acceptance), renderSpecMarkdown(ideaRow.title, spec), now, ideaId);
      createMilestones(ideaId, added);
    })();
  }
}
