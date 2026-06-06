import React from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type BlockType =
  | 'text'
  | 'think'
  | 'tool_call'
  | 'tool_response'
  | 'function_calls'
  | 'result'
  | 'artifact';

interface ParsedBlock {
  type: BlockType;
  content: string;
  /** Preserved raw tag attributes, e.g. <artifact type="code" title="..."> */
  attrs?: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPILED REGEXES — module-level so they are built only once
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Invisible control tokens that must be stripped before rendering.
 * Covers: ChatML, GPT-2/LLaMA EOS, LLaMA-2/3, Phi-3/4, Mistral, DeepSeek.
 */
const CONTROL_TOKENS_RE = new RegExp(
  [
    // ── ChatML (Qwen, Mistral-instruct, etc.) ───────────────────────────────
    '<\\|im_start\\|>[^\\n]*(?:\\n|$)',   // <|im_start|>role\n
    '<\\|im_end\\|>',

    // ── GPT-2 / LLaMA family EOS ────────────────────────────────────────────
    '<\\|endoftext\\|>',
    '<\\|end_of_text\\|>',
    '<\\|file_separator\\|>',

    // ── LLaMA 3 special tokens ──────────────────────────────────────────────
    '<\\|eot_id\\|>',                     // End of Turn
    '<\\|eom_id\\|>',                     // End of Message
    '<\\|start_header_id\\|>[\\s\\S]*?<\\|end_header_id\\|>',  // role header
    '<\\|python_tag\\|>',

    // ── LLaMA 2 / Mistral chat tokens ───────────────────────────────────────
    '\\[INST\\]',
    '\\[/INST\\]',
    '<<SYS>>[\\s\\S]*?<</SYS>>',
    '(?:^|\\s)<s>(?=\\s|$)',             // BOS (avoid stripping HTML <s>)
    '</s>',

    // ── Phi-3 / Phi-4 ───────────────────────────────────────────────────────
    '<\\|system\\|>',
    '<\\|user\\|>',
    '<\\|assistant\\|>',
    '<\\|end\\|>',
    '<\\|sep\\|>',

    // ── DeepSeek (uses full-width ｜ U+FF5C) ─────────────────────────────────
    '<｜begin▁of▁sentence｜>',
    '<｜end▁of▁sentence｜>',
    '<｜User｜>',
    '<｜Assistant｜>',
    '<｜EOT｜>',

    // ── Mistral tool-use bracketed sections ─────────────────────────────────
    '\\[AVAILABLE_TOOLS\\][\\s\\S]*?\\[/AVAILABLE_TOOLS\\]',
    '\\[TOOL_RESULTS\\][\\s\\S]*?\\[/TOOL_RESULTS\\]',

    // ── Gemma / Gemini ───────────────────────────────────────────────────────
    '<start_of_turn>(?:user|model)\\n',
    '<end_of_turn>',

    // ── Falcon ──────────────────────────────────────────────────────────────
    '>>INTRODUCTION<<',
    '>>SUMMARY<<',
    '>>ABSTRACT<<',
    'User:(?=\\s)',
    'Assistant:(?=\\s)',
  ].join('|'),
  'gi',
);

/**
 * Regex that splits the cleaned text into semantic blocks.
 * Each branch handles the streaming case where the closing tag may be absent.
 * 
 * Captured groups (kept by split):
 *   think | tool_call | tool_response | function_calls | result | artifact
 */
const BLOCK_SPLITTER_RE = new RegExp(
  [
    // <think> … </think>  — chain-of-thought (Qwen3, DeepSeek-R1, QwQ)
    '(<think>[\\s\\S]*?(?:</think>|$))',
    // <tool_call> … </tool_call>
    '(<tool_call>[\\s\\S]*?(?:</tool_call>|$))',
    // <tool_response> … </tool_response>
    '(<tool_response>[\\s\\S]*?(?:</tool_response>|$))',
    // <function_calls> … </function_calls>  (Anthropic XML-style)
    '(<function_calls>[\\s\\S]*?(?:</function_calls>|$))',
    // <result> … </result>
    '(<result>[\\s\\S]*?(?:</result>|$))',
    // <artifact ...> … </artifact>  (Claude / various)
    '(<artifact(?:\\s[^>]*)?>[ \\s\\S]*?(?:</artifact>|$))',
  ].join('|'),
  'gi',
);

// ─────────────────────────────────────────────────────────────────────────────
// PARSER
// ─────────────────────────────────────────────────────────────────────────────

/** Parse raw attribute string → key/value map */
function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\w[\w-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    attrs[m[1]] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

/** Strip a known wrapping tag pair and return inner text + optional attrs */
function unwrap(
  text: string,
  tag: string,
): { content: string; attrs: Record<string, string> } {
  const openRe = new RegExp(`^<${tag}(\\s[^>]*)?>`, 'i');
  const closeRe = new RegExp(`</${tag}>\\s*$`, 'i');
  const attrMatch = openRe.exec(text);
  const attrs = attrMatch?.[1] ? parseAttrs(attrMatch[1]) : {};
  const content = text
    .replace(openRe, '')
    .replace(closeRe, '')
    .trim();
  return { content, attrs };
}

/** Convert a raw string segment into a typed ParsedBlock */
function classify(segment: string): ParsedBlock {
  const lower = segment.trimStart().toLowerCase();

  if (lower.startsWith('<think>')) {
    const { content } = unwrap(segment, 'think');
    return { type: 'think', content };
  }
  if (lower.startsWith('<tool_call>')) {
    const { content } = unwrap(segment, 'tool_call');
    return { type: 'tool_call', content };
  }
  if (lower.startsWith('<tool_response>')) {
    const { content } = unwrap(segment, 'tool_response');
    return { type: 'tool_response', content };
  }
  if (lower.startsWith('<function_calls>')) {
    const { content } = unwrap(segment, 'function_calls');
    return { type: 'function_calls', content };
  }
  if (lower.startsWith('<result>')) {
    const { content } = unwrap(segment, 'result');
    return { type: 'result', content };
  }
  if (lower.startsWith('<artifact')) {
    const { content, attrs } = unwrap(segment, 'artifact');
    return { type: 'artifact', content, attrs };
  }
  return { type: 'text', content: segment };
}

/** Full parsing pipeline: strip → split → classify → filter empties */
function parseBlocks(raw: string): ParsedBlock[] {
  const cleaned = raw.replace(CONTROL_TOKENS_RE, '').trim();
  if (!cleaned) return [];

  // Fast-path: no renderable blocks → skip the split
  if (!/<(think|tool_call|tool_response|function_calls|result|artifact)/i.test(cleaned)) {
    return [{ type: 'text', content: cleaned }];
  }

  return cleaned
    .split(BLOCK_SPLITTER_RE)
    .filter((s): s is string => Boolean(s?.trim()))
    .map(classify)
    .filter(b => b.content.length > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK RENDERERS
// ─────────────────────────────────────────────────────────────────────────────

function ThinkBlock({ content }: { content: string }) {
  return (
    <div className="my-2 p-3 rounded-xl border-l-4 border-primary/40 bg-primary/5 text-muted-foreground/80 text-xs italic opacity-80">
      <div className="font-bold text-[10px] uppercase tracking-wider mb-1 opacity-60">
        Neural Synthesis Pipeline
      </div>
      {content}
    </div>
  );
}

function ToolCallBlock({ content }: { content: string }) {
  let display = content;
  try {
    display = JSON.stringify(JSON.parse(content), null, 2);
  } catch { /* keep raw */ }

  return (
    <div className="my-2 rounded-xl border border-blue-500/20 bg-blue-500/5 overflow-hidden text-xs font-mono">
      <div className="px-3 py-1 border-b border-blue-500/15 font-bold text-[10px] uppercase tracking-wider text-blue-500/70">
        Tool Call
      </div>
      <pre className="p-3 whitespace-pre-wrap break-all">{display}</pre>
    </div>
  );
}

function ToolResponseBlock({ content }: { content: string }) {
  let display = content;
  try {
    display = JSON.stringify(JSON.parse(content), null, 2);
  } catch { /* keep raw */ }

  return (
    <div className="my-2 rounded-xl border border-green-500/20 bg-green-500/5 overflow-hidden text-xs font-mono">
      <div className="px-3 py-1 border-b border-green-500/15 font-bold text-[10px] uppercase tracking-wider text-green-500/70">
        Tool Response
      </div>
      <pre className="p-3 whitespace-pre-wrap break-all">{display}</pre>
    </div>
  );
}

function FunctionCallsBlock({ content }: { content: string }) {
  return (
    <div className="my-2 rounded-xl border border-violet-500/20 bg-violet-500/5 overflow-hidden text-xs font-mono">
      <div className="px-3 py-1 border-b border-violet-500/15 font-bold text-[10px] uppercase tracking-wider text-violet-500/70">
        Function Calls
      </div>
      <pre className="p-3 whitespace-pre-wrap break-all">{content}</pre>
    </div>
  );
}

function ResultBlock({ content }: { content: string }) {
  return (
    <div className="my-2 rounded-xl border border-amber-500/20 bg-amber-500/5 overflow-hidden text-xs font-mono">
      <div className="px-3 py-1 border-b border-amber-500/15 font-bold text-[10px] uppercase tracking-wider text-amber-500/70">
        Result
      </div>
      <pre className="p-3 whitespace-pre-wrap break-all">{content}</pre>
    </div>
  );
}

function ArtifactBlock({
  content,
  attrs = {},
}: {
  content: string;
  attrs?: Record<string, string>;
}) {
  const title = attrs.title ?? attrs.identifier ?? 'Artifact';
  const type = attrs.type ?? 'text';

  return (
    <div className="my-2 rounded-xl border border-purple-500/20 bg-purple-500/5 overflow-hidden text-xs font-mono">
      <div className="flex items-center gap-2 px-3 py-1 border-b border-purple-500/15">
        <span className="font-bold text-[10px] uppercase tracking-wider text-purple-500/70">
          {title}
        </span>
        {type && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400/60 uppercase tracking-wide">
            {type}
          </span>
        )}
      </div>
      <pre className="p-3 whitespace-pre-wrap break-all">{content}</pre>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats a raw LLM message string into React nodes.
 * Strips all control tokens and renders semantic blocks (think, tool_call, etc.)
 * as visually distinct components.
 *
 * Returns a plain string when no block rendering is needed (zero JSX overhead).
 */
export function formatAiMessage(content: string): React.ReactNode {
  if (!content) return null;

  const blocks = parseBlocks(content);
  if (blocks.length === 0) return null;

  // Zero-cost fast path: pure text, no wrapping element needed
  if (blocks.length === 1 && blocks[0].type === 'text') {
    return blocks[0].content;
  }

  return (
    <>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'think':
            return <ThinkBlock key={i} content={block.content} />;
          case 'tool_call':
            return <ToolCallBlock key={i} content={block.content} />;
          case 'tool_response':
            return <ToolResponseBlock key={i} content={block.content} />;
          case 'function_calls':
            return <FunctionCallsBlock key={i} content={block.content} />;
          case 'result':
            return <ResultBlock key={i} content={block.content} />;
          case 'artifact':
            return <ArtifactBlock key={i} content={block.content} attrs={block.attrs} />;
          default:
            return <span key={i}>{block.content}</span>;
        }
      })}
    </>
  );
}

/**
 * Strips ALL AI block tags and control tokens, returning clean plain text.
 * Useful for feed summaries, previews, and search indexing.
 */
export function stripAiThoughts(content: string): string {
  if (!content) return '';
  return content
    .replace(CONTROL_TOKENS_RE, '')
    .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '')
    .replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|$)/gi, '')
    .replace(/<tool_response>[\s\S]*?(?:<\/tool_response>|$)/gi, '')
    .replace(/<function_calls>[\s\S]*?(?:<\/function_calls>|$)/gi, '')
    .replace(/<result>[\s\S]*?(?:<\/result>|$)/gi, '')
    .replace(/<artifact[\s\S]*?>[\s\S]*?(?:<\/artifact>|$)/gi, '')
    .trim();
}

/** Typed re-export of parseBlocks for unit testing and custom renderers */
export { parseBlocks, type ParsedBlock, type BlockType };