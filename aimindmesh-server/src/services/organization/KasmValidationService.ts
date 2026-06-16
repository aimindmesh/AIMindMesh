import { ValidationResult } from './types';
import { KasmService } from '../KasmService';
import { config } from '../../config';

// Timeout for individual exec commands (ms)
const EXEC_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Runs software validation inside a fresh Kasm Ubuntu workspace.
 * Uses KasmService.executeCommand() (Kasm API) instead of docker exec,
 * which avoids the need for Docker socket access from the server container.
 */
export class KasmValidationService {
  async runValidation(repoUrl: string, mode: 'smoke' | 'deploy-preview'): Promise<ValidationResult> {
    // 0. Auto-cleanup leftover sessions to ensure resource availability
    try {
      const activeSessions = await KasmService.listSessions();
      for (const s of activeSessions) {
        if (s.image_id === config.kasm?.defaultImage || s.user_id === config.kasm?.userId) {
          console.log(`[KasmValidationService] Cleaning up leftover session to free slot: ${s.kasm_id}`);
          await KasmService.destroySession(s.kasm_id).catch(() => {});
        }
      }
      // Wait for cleanup to propagate
      if (activeSessions.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    } catch (cleanErr: any) {
      console.warn('[KasmValidationService] Leftover session cleanup failed:', cleanErr.message);
    }

    const session = await KasmService.requestSession();
    if (!session || !session.kasm_id) {
      const errMsg = (session as any)?.error_message || JSON.stringify(session);
      throw new Error(`Failed to request Kasm session: ${errMsg}`);
    }
    const kasmId = session.kasm_id;
    console.log(`[KasmValidationService] Session provisioned: ${kasmId}`);

    // Resolve Gitea hostname to IP and inject authentication token if available
    let resolvedUrl = repoUrl;
    try {
      const urlObj = new URL(repoUrl);
      if (urlObj.hostname === 'gitea') {
        const dns = require('node:dns/promises');
        const address = await dns.lookup('gitea');
        urlObj.hostname = address.address;
      }
      if (process.env.GITEA_TOKEN && !urlObj.username) {
        urlObj.username = 'token';
        urlObj.password = process.env.GITEA_TOKEN;
      }
      resolvedUrl = urlObj.toString();
    } catch (err: any) {
      console.warn('[KasmValidationService] Failed to process repoUrl:', err.message);
    }

    const logs: string[] = [];

    const execCmd = async (cmd: string, label: string): Promise<string> => {
      console.log(`[KasmValidationService] Executing [${label}]: ${cmd.substring(0, 80)}...`);
      const result = await Promise.race([
        KasmService.executeCommand(kasmId, cmd),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Command timed out after ${EXEC_TIMEOUT_MS / 1000}s: ${label}`)), EXEC_TIMEOUT_MS)
        ),
      ]);
      const output = typeof result === 'object' ? JSON.stringify(result) : String(result ?? '');
      logs.push(`[${label}] ${output}`);
      return output;
    };

    try {
      // Wait for container to be fully provisioned (Kasm needs ~20s for Ubuntu workspace)
      console.log('[KasmValidationService] Waiting 20s for workspace to provision...');
      await new Promise(resolve => setTimeout(resolve, 20000));

      // 1. Install Node.js, npm, and git
      await execCmd(
        'apt-get update && apt-get install -y nodejs npm git 2>&1',
        'install-deps'
      );

      // 2. Clone the repository
      await execCmd(
        `rm -rf /tmp/val-repo && git clone ${resolvedUrl} /tmp/val-repo 2>&1`,
        'git-clone'
      );

      // 3. Install project dependencies
      await execCmd(
        'cd /tmp/val-repo && npm install 2>&1',
        'npm-install'
      );

      // 4. Run build or test
      const testCmd = mode === 'smoke'
        ? 'cd /tmp/val-repo && npm test 2>&1'
        : 'cd /tmp/val-repo && npm run build 2>&1';

      await execCmd(testCmd, mode === 'smoke' ? 'npm-test' : 'npm-build');

      return {
        status: 'passed',
        summary: 'Validation run completed successfully.',
        logs,
      };
    } catch (e: any) {
      logs.push(`[error] ${e.message}`);
      return {
        status: 'failed',
        summary: `Validation failed: ${e.message}`,
        logs,
      };
    } finally {
      try {
        console.log(`[KasmValidationService] Destroying session ${kasmId}`);
        await KasmService.destroySession(kasmId);
      } catch (err) {
        console.error('[KasmValidationService] Failed to destroy Kasm session:', err);
      }
    }
  }
}
