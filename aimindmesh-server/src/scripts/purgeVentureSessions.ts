/**
 * One-shot cleanup: deletes the OpenClaw `develop-<repo>` sessions of every venture repository.
 *
 * Until the 2026-10 hardening the development prompt carried the Gitea token in the clone URL,
 * so these transcripts hold it. Run once inside the server container after the deploy:
 *   node dist/scripts/purgeVentureSessions.js
 */
import db from '../db/sqlite';
import { clearSession, getSessionHistory } from '../services/OpenClawBridge';

const CONNECT_TIMEOUT_MS = 30_000;

async function waitForGateway(): Promise<boolean> {
  const deadline = Date.now() + CONNECT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      // chat.history needs the WebSocket: it throws until the bridge is connected
      await getSessionHistory('purge-venture-sessions-probe');
      return true;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return false;
}

async function main(): Promise<number> {
  const repos = db.prepare('SELECT repo_name FROM organization_repositories').all() as { repo_name: string }[];
  if (repos.length === 0) {
    console.log('No venture repositories: nothing to purge.');
    return 0;
  }
  if (!(await waitForGateway())) {
    console.error('OpenClaw gateway not reachable: nothing was deleted.');
    return 1;
  }
  let failures = 0;
  for (const { repo_name } of repos) {
    const sessionKey = `develop-${repo_name}`;
    try {
      await clearSession(sessionKey);
      console.log(`Deleted session ${sessionKey}`);
    } catch (err: any) {
      failures++;
      console.error(`Could not delete ${sessionKey}: ${err.message}`);
    }
  }
  return failures === 0 ? 0 : 1;
}

main()
  .then(code => process.exit(code))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
