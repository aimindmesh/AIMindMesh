import { ValidationResult } from './types';
import { KasmService } from '../KasmService';
import { config } from '../../config';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { shQuote } from '../../utils/shell';

const execFileAsync = promisify(execFile);

/** Hides the Gitea token embedded in clone URLs from stored logs and summaries. */
function maskToken(text: string): string {
  const token = process.env.GITEA_TOKEN;
  return token ? text.split(token).join('***') : text;
}

// Timeout for individual exec commands (ms)
const EXEC_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Runs software validation inside a fresh Kasm Ubuntu workspace.
 * Uses `docker exec kasm docker exec adminkasm.lo_<id>` to execute commands.
 * Requires Docker socket mounted in the server container.
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

    // Container name = adminkasm.lo_<first 8 chars of kasm_id> (before first hyphen)
    const shortId = kasmId.split('-')[0];
    const containerName = `adminkasm.lo_${shortId}`;
    if (!/^[\w.-]+$/.test(containerName)) {
      await KasmService.destroySession(kasmId).catch(() => {});
      throw new Error(`Unexpected Kasm container name: ${containerName}`);
    }
    console.log(`[KasmValidationService] Session ${kasmId} -> container: ${containerName}`);

    // Resolve Gitea hostname and inject auth token
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

    const execInWorkspace = async (shellCmd: string, label: string): Promise<string> => {
      console.log(`[KasmValidationService] [${label}] Running command...`);
      // docker exec kasm docker exec -u root <containerName> sh -c '<cmd>'
      // execFile: no local shell, shellCmd is only interpreted by sh inside the workspace
      const { stdout, stderr } = await execFileAsync(
        'docker',
        ['exec', '-u', 'root', 'kasm', 'docker', 'exec', '-u', 'root', containerName, 'sh', '-c', shellCmd],
        { timeout: EXEC_TIMEOUT_MS }
      );
      const output = [stdout, stderr].filter(Boolean).join('\n');
      logs.push(`[${label}] ${maskToken(output)}`);
      return output;
    };

    try {
      // Wait for workspace container to fully provision inside Kasm DinD
      console.log('[KasmValidationService] Waiting 20s for workspace to provision...');
      await new Promise(resolve => setTimeout(resolve, 20000));

      // 1. Install Node.js, npm, and git
      await execInWorkspace(
        'apt-get update -qq && apt-get install -y nodejs npm git 2>&1',
        'install-deps'
      );

      // 2. Clone the repository
      await execInWorkspace(
        `rm -rf /tmp/val-repo && git clone ${shQuote(resolvedUrl)} /tmp/val-repo 2>&1`,
        'git-clone'
      );

      // 3. Install project dependencies
      await execInWorkspace(
        'cd /tmp/val-repo && npm install 2>&1',
        'npm-install'
      );

      // 4. Run build or test based on mode
      const testCmd = mode === 'smoke'
        ? 'cd /tmp/val-repo && npm test 2>&1'
        : 'cd /tmp/val-repo && npm run build 2>&1';

      await execInWorkspace(testCmd, mode === 'smoke' ? 'npm-test' : 'npm-build');

      return {
        status: 'passed',
        summary: 'Validation run completed successfully.',
        logs,
      };
    } catch (e: any) {
      const errLogs = [e.message, e.stdout, e.stderr].filter(Boolean).map((l: string) => maskToken(String(l)));
      return {
        status: 'failed',
        summary: `Validation failed: ${maskToken(String(e.message))}`,
        logs: [...logs, ...errLogs],
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
