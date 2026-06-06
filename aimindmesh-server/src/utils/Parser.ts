import { Logger } from './Logger';

export class Parser {
  /**
   * Extracts and parses JSON from a string that might be wrapped in markdown code blocks.
   * Uses multiple fallback strategies to handle LLM formatting inconsistencies.
   */
  static parseLLMJson(content: string): any {
    if (!content) throw new Error('Empty content provided to parser');

    const raw = content.trim();

    // --- Strategy 1: explicit ```json block ---
    const jsonBlock = raw.match(/```json[\r\n]+([\s\S]+?)[\r\n]+```/i)
                  || raw.match(/```json([\s\S]+?)```/i);
    if (jsonBlock && jsonBlock[1]) {
      try {
        return JSON.parse(this.fixControlChars(jsonBlock[1].trim()));
      } catch (e: any) {
        Logger.warn('Parser', `S1 failed: ${e.message}`);
      }
    }

    // --- Strategy 2: any ``` block ---
    const anyBlock = raw.match(/```[\r\n]+([\s\S]+?)[\r\n]+```/)
                  || raw.match(/```([\s\S]+?)```/);
    if (anyBlock && anyBlock[1]) {
      const candidate = anyBlock[1].trim();
      // Only try if it looks like JSON
      if (candidate.startsWith('{') || candidate.startsWith('[')) {
        try {
          return JSON.parse(this.fixControlChars(candidate));
        } catch (e: any) {
          Logger.warn('Parser', `S2 failed: ${e.message}`);
        }
      }
    }

    // --- Strategy 3: first { to last } ---
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first !== -1 && last > first) {
      try {
        return JSON.parse(this.fixControlChars(raw.substring(first, last + 1)));
      } catch (e: any) {
        Logger.warn('Parser', `S3 failed: ${e.message}`);
      }
    }

    // --- Strategy 4: raw content (last resort) ---
    try {
      return JSON.parse(this.fixControlChars(raw));
    } catch (e: any) {
      Logger.error('Parser', `All strategies failed. Error: ${e.message}`);
      throw new Error(`LLM response did not contain valid JSON: ${e.message}`);
    }
  }

  /**
   * Fixes unescaped control characters inside JSON string values using a
   * character-by-character scanner that tracks string boundaries.
   */
  private static fixControlChars(str: string): string {
    // Remove markdown fences that may have leaked in
    let result = str.replace(/^```json\n?|^```\n?|```$/gm, '').trim();

    // Remove comments
    result = result.replace(/\/\*[\s\S]*?\*\//g, '');

    // Remove trailing commas
    result = result.replace(/,(\s*[\]}])/g, '$1');

    // Scan character-by-character to escape real control chars inside strings
    let out = '';
    let inString = false;
    let escaped = false;

    for (let i = 0; i < result.length; i++) {
      const ch = result[i];
      const code = result.charCodeAt(i);

      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }

      if (ch === '\\' && inString) {
        const next = result[i + 1];
        // If next char is NOT a valid JSON escape sequence, escape the backslash itself
        if (!'\\"\/bfnrtu'.includes(next)) {
          out += '\\';
        }
        out += ch;
        escaped = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        out += ch;
        continue;
      }

      if (inString) {
        if (ch === '\n') { out += '\\n'; continue; }
        if (ch === '\r') { out += '\\r'; continue; }
        if (ch === '\t') { out += '\\t'; continue; }
        if (code < 0x20) { continue; } // drop other control chars
      }

      out += ch;
    }

    return out.trim();
  }
}
