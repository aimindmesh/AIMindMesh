/**
 * Search/replace edits from the code generation model, applied deterministically: every search
 * text must occur exactly once in the current content of its file (after the previous edits of
 * the same file). A model that rewrites whole files truncates and drops code silently; an edit
 * that does not apply fails loudly instead.
 */

export interface FileEdit {
  path: string;
  search: string;
  replace: string;
}

export type EditResult = { ok: true; files: Record<string, string>; changed: string[] } | { ok: false; error: string };

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) count++;
  return count;
}

export function parseEdits(raw: unknown): FileEdit[] | null {
  if (!Array.isArray(raw)) return null;
  const edits: FileEdit[] = [];
  for (const e of raw) {
    if (!e || typeof e.path !== 'string' || typeof e.search !== 'string' || typeof e.replace !== 'string') return null;
    edits.push({ path: e.path.trim(), search: e.search, replace: e.replace });
  }
  return edits;
}

/** Applies the edits to `files` (path -> current content). Paths must be keys of `files`. */
export function applyEdits(files: Record<string, string>, edits: FileEdit[]): EditResult {
  const out = { ...files };
  const changed = new Set<string>();
  for (const [i, edit] of edits.entries()) {
    const content = out[edit.path];
    if (content === undefined) return { ok: false, error: `Edit ${i + 1}: unknown file ${edit.path}` };
    if (!edit.search) return { ok: false, error: `Edit ${i + 1} on ${edit.path}: empty search text` };
    const found = occurrences(content, edit.search);
    if (found !== 1) {
      return { ok: false, error: `Edit ${i + 1} on ${edit.path}: search text found ${found} times (it must match exactly one place)` };
    }
    out[edit.path] = content.replace(edit.search, () => edit.replace);
    changed.add(edit.path);
  }
  return { ok: true, files: out, changed: [...changed] };
}
