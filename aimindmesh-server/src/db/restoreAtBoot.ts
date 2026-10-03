import { applyPendingRestore } from './restore';

// Side-effect module, imported on the first line of index.ts: a restore staged by the
// admin API is applied before config.json is read and the database is opened.
try {
  applyPendingRestore();
} catch (err: any) {
  console.error(`[Restore] Unexpected error, starting with current data: ${err.message}`);
}
