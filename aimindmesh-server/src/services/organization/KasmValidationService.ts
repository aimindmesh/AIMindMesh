import { ValidationResult } from './types';
import { KasmService } from '../KasmService';

export class KasmValidationService {
  async runValidation(repoUrl: string, mode: 'smoke' | 'deploy-preview'): Promise<ValidationResult> {
    const session = await KasmService.requestSession();
    const kasmId = session.kasm_id;
    
    try {
      // Create workspace directory, clone repository, and run validation commands
      const cloneCmd = `git clone ${repoUrl} /tmp/val-repo`;
      await KasmService.executeCommand(kasmId, cloneCmd);

      const runCmd = mode === 'smoke' 
        ? 'cd /tmp/val-repo && npm install && npm test' 
        : 'cd /tmp/val-repo && npm install && npm run build';

      const executionResult = await KasmService.executeCommand(kasmId, runCmd);

      // Extract details from execution result
      const stdout = executionResult?.stdout || '';
      const stderr = executionResult?.stderr || '';
      const exitCode = typeof executionResult?.exit_code === 'number' ? executionResult.exit_code : 0;

      return {
        status: exitCode === 0 ? 'passed' : 'failed',
        summary: exitCode === 0 ? 'Validation run completed successfully.' : 'Validation run failed with non-zero exit code.',
        logs: [stdout, stderr].filter(Boolean),
      };
    } catch (e: any) {
      return {
        status: 'failed',
        summary: `Validation failed: ${e.message}`,
        logs: [e.stack].filter(Boolean),
      };
    } finally {
      try {
        await KasmService.destroySession(kasmId);
      } catch (err) {
        console.error('Failed to destroy Kasm session:', err);
      }
    }
  }
}

