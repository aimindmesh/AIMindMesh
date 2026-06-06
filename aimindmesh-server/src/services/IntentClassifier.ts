import { InferenceRouter } from './InferenceRouter';
import { GiteaService } from './GiteaService';
import { Parser } from '../utils/Parser';
import { Logger } from '../utils/Logger';

export type IntentCategory = 'CHAT' | 'DEVELOPMENT' | 'NEW_PROJECT';

export interface IntentResult {
  category: IntentCategory;
  projectName?: string;
  scope?: 'modification' | 'creation';
  taskMetadata?: any;
  reasoning: string;
}

const INTENT_PROMPT = (message: string, existingRepos: string[]) => `
You are an intent classifier for the AIMindMesh Ecosystem.
Your goal is to determine if the user wants to engage in a standard chat, modify existing code, or start a new project.

EXISTING PROJECTS:
${existingRepos.map(r => `- ${r}`).join('\n')}

USER MESSAGE:
"${message}"

Classify the message into one of these categories:
1. CHAT: General conversation, questions, or non-technical requests.
2. DEVELOPMENT: Request to modify existing code in one of the existing projects.
3. NEW_PROJECT: Request to create a completely new project or repository.

If it's DEVELOPMENT, try to identify which PROJECT it belongs to.
If it's NEW_PROJECT, suggest a name for the new repository.

Respond ONLY with valid JSON in this format:
{
  "category": "CHAT | DEVELOPMENT | NEW_PROJECT",
  "projectName": "name of the project or suggested new project name",
  "scope": "modification | creation",
  "reasoning": "short explanation",
  "taskMetadata": {
    "goal": "technical goal extracted from the prompt",
    "targetFiles": ["potential", "files", "to", "touch"]
  }
}
`.trim();

export class IntentClassifier {
  public static async classify(message: string): Promise<IntentResult> {
    try {
      const repos = await GiteaService.listUserRepos();
      const repoNames = repos.map((r: any) => r.name);
      
      const response = await InferenceRouter.complete(
        INTENT_PROMPT(message, repoNames),
        'INTENT_CLASSIFICATION',
        { taskName: 'Intent Classification' }
      );
      
      const parsed = Parser.parseLLMJson(response);
      
      return {
        category: parsed.category || 'CHAT',
        projectName: parsed.projectName,
        scope: parsed.scope,
        taskMetadata: parsed.taskMetadata,
        reasoning: parsed.reasoning || 'Default classification'
      };
    } catch (err: any) {
      Logger.error('IntentClassifier', `Classification failed: ${err.message}`);
      return { category: 'CHAT', reasoning: 'Fallback due to error' };
    }
  }
}
