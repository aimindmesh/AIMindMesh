import React, { useState } from 'react';
import { Message } from '../../types';
import { RefreshIcon, SendIcon, SpeakerIcon } from '../../constants';

interface MessageBubbleProps {
  message: Message;
  onResend?: (message: Message) => void;
  onRegenerate?: (message: Message) => void;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, onResend, onRegenerate }) => {

  const linkify = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.split(urlRegex).map((part, i) => {
      // Odd indices are the captured URLs from split
      if (i % 2 === 1) {
        // Handle trailing punctuation (.,;:!?) often found in sentences
        const match = part.match(/^(.*)([.,:;!?)])$/);
        if (match) {
          const [_, url, punct] = match;
          return (
            <React.Fragment key={i}>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:text-cyan-300 hover:underline break-all relative z-10"
                onClick={(e) => e.stopPropagation()}
              >
                {url}
              </a>
              {punct}
            </React.Fragment>
          );
        }
        return (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-400 hover:text-cyan-300 hover:underline break-all relative z-10"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        );
      }
      return part;
    });
  };
  const isUser = message.role === 'user';
  const { thinking: parsedThinking, tools: parsedTools, cleanText } = React.useMemo(() => {
    const text = message.text || '';

    // Extract thinking (Streaming-aware: matches closing tag OR end of string)
    // Extract thinking (Streaming-aware: matches closing tag OR end of string)
    // Supports <think>, <thinking>, [thinking], <thought>, [thought], <|channel>thought, Thinking Process:, Thought:
    const thinkingMatch = text.match(/(?:<think(?:ing)?>|\[thinking\]|<thought>|\[thought\]|<\|channel(?:\|)?>thought|Thinking Process:|Thought:)([\s\S]*?)(?:<\/think(?:ing)?>|\[\/thinking\]|<\/thought>|\[\/thought\]|<\|?channel\|?>|$)/i);
    const thinking = thinkingMatch ? thinkingMatch[1] : null;

    // Extract tools (Streaming-aware)
    // Supports <tool> or <tool_code>
    const toolMatches = [...text.matchAll(/<tool(?:_code)?>([\s\S]*?)(?:<\/tool(?:_code)?>|$)/gi)];
    const tools = toolMatches.map(m => m[1]);

    // Clean text by removing the tags and their content
    let clean = text
      .replace(/(?:<think(?:ing)?>|\[thinking\]|<thought>|\[thought\]|<\|channel(?:\|)?>thought|Thinking Process:|Thought:)([\s\S]*?)(?:<\/think(?:ing)?>|\[\/thinking\]|<\/thought>|\[\/thought\]|<\|?channel\|?>|$)/gi, '')
      .replace(/<tool(?:_code)?>([\s\S]*?)(?:<\/tool(?:_code)?>|$)/gi, '')
      .trim();

    return { thinking, tools, cleanText: clean };
  }, [message.text]);

  const displayThinking = message.thinking || parsedThinking;
  const displayTools = parsedTools.length > 0 ? parsedTools : null;

  // Default to collapsed as requested by user. Parser fix ensures final answer is visible as text.
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [toolCallsExpanded, setToolCallsExpanded] = useState(false);

  if (isUser) {
    return (
      <div className="flex flex-col items-end mb-3 animate-fade-in group">
        <div
          className="max-w-[85%] md:max-w-[70%] px-5 py-3 rounded-2xl rounded-tr-sm bg-user-bubble-gradient text-white shadow-lg shadow-primary/10 backdrop-blur-sm relative"
        >
          {message.images && message.images.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {message.images.map((img, idx) => (
                <img
                  key={idx}
                  src={img.webPath || (img.base64 ? `data:${img.mimeType};base64,${img.base64}` : '')}
                  className="max-w-full max-h-48 rounded-lg object-contain"
                  alt={img.name || `Image ${idx + 1}`}
                />
              ))}
            </div>
          )}
          {message.audio && message.audio.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {message.audio.map((aud, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-white/10 px-3 py-2 rounded-lg border border-white/10">
                  <SpeakerIcon className="w-4 h-4 text-white/80" />
                  <span className="text-xs text-white/90 truncate max-w-[150px]">{aud.name || 'Audio File'}</span>
                  {aud.duration && <span className="text-[10px] text-white/60">{Math.round(aud.duration)}s</span>}
                </div>
              ))}
            </div>
          )}
          {message.files && message.files.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {message.files.map((file, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-white/10 px-3 py-2 rounded-lg border border-white/10">
                  <span className="text-lg">📄</span>
                  <div className="flex flex-col">
                    <span className="text-xs text-white/90 truncate max-w-[150px] font-medium">{file.name}</span>
                    <span className="text-xs text-white/60 uppercase">{file.mimeType.split('/').pop()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="whitespace-pre-wrap leading-relaxed text-[15px] font-medium tracking-wide">{message.text}</p>
          <p className="text-[10px] text-white/70 text-right mt-1 font-medium tracking-wider">{message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
        </div>

        {/* Resend Action */}
        {onResend && (
          <button
            onClick={() => onResend(message)}
            className="mt-1 mr-1 p-1.5 text-gray-500 hover:text-white bg-transparent hover:bg-white/10 rounded-full transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
            title="Resend"
            aria-label="Resend message"
          >
            <SendIcon className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }


  // Model message layout (Replika style: minimalist dark glass)
  return (
    <div className="flex flex-col items-start mb-3 animate-fade-in group">
      <div
        className="max-w-[85%] md:max-w-[70%] px-5 py-3 rounded-2xl rounded-tl-sm bg-surface/60 backdrop-blur-md border border-white/5 text-gray-100 shadow-md relative"
      >
        {/* Thinking Block - Collapsible */}
        {displayThinking !== null && (
          <div className="mb-3">
            <button
              onClick={() => setThinkingExpanded(!thinkingExpanded)}
              className="flex items-center gap-2 text-xs text-purple-400 hover:text-purple-300 transition-colors w-full text-left"
            >
              <span className={`transform transition-transform ${thinkingExpanded ? 'rotate-90' : ''}`}>▶</span>
              <span>💭 Thinking</span>
              <span className="text-[10px] text-gray-500">
                {thinkingExpanded ? 'Hide' : 'Show'}
              </span>
            </button>
            {thinkingExpanded && (
              <div className="mt-2 p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                <p className="text-[13px] text-gray-300 italic whitespace-pre-wrap leading-relaxed">
                  {linkify(displayThinking)}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Tool Calls Block - Collapsible (From Text Parsing) */}
        {displayTools && (
          <div className="mb-3">
            <button
              onClick={() => setToolCallsExpanded(!toolCallsExpanded)}
              className="flex items-center gap-2 text-xs text-amber-400 hover:text-amber-300 transition-colors w-full text-left"
            >
              <span className={`transform transition-transform ${toolCallsExpanded ? 'rotate-90' : ''}`}>▶</span>
              <span>🛠️ Tool Calls ({displayTools.length})</span>
              <span className="text-[10px] text-gray-500">
                {toolCallsExpanded ? 'Hide' : 'Show'}
              </span>
            </button>
            {toolCallsExpanded && (
              <div className="mt-2 space-y-2">
                {displayTools.map((tool, idx) => (
                  <div key={idx} className="p-2 bg-amber-500/5 border border-amber-500/10 rounded-lg">
                    <code className="text-[11px] text-amber-200 block whitespace-pre-wrap font-mono">{tool}</code>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tool Results Block - Collapsible */}
        {message.toolResults && message.toolResults.length > 0 && (
          <div className="mb-3">
            <button
              onClick={() => setToolsExpanded(!toolsExpanded)}
              className="flex items-center gap-2 text-xs text-cyan-400 hover:text-cyan-300 transition-colors w-full text-left"
            >
              <span className={`transform transition-transform ${toolsExpanded ? 'rotate-90' : ''}`}>▶</span>
              <span>🔧 Tools ({message.toolResults.length})</span>
              <span className="text-[10px] text-gray-500">
                {toolsExpanded ? 'Hide' : 'Show'}
              </span>
            </button>
            {toolsExpanded && (
              <div className="mt-2 space-y-2">
                {message.toolResults.map((tool, idx) => {
                  // Clean system instructions from tool output
                  const cleanResult = tool.result
                    ? tool.result
                      .split('\n\n')
                      .filter(block => !block.trim().startsWith('[SYSTEM'))
                      .join('\n\n')
                      .trim()
                    : '';

                  return (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg border ${tool.success ? 'bg-green-500/10 border-green-500/20' : 'bg-red-500/10 border-red-500/20'}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span>{tool.success ? '✅' : '❌'}</span>
                        <span className="text-xs font-medium text-gray-200">{tool.name}</span>
                      </div>
                      <p className="text-[12px] text-gray-400 whitespace-pre-wrap line-clamp-4">
                        {linkify(cleanResult)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Audio Attachments (Model) */}
        {message.audio && message.audio.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {message.audio.map((aud, idx) => (
              <div key={idx} className="flex items-center gap-2 bg-white/5 px-3 py-2 rounded-lg border border-white/10">
                <SpeakerIcon className="w-4 h-4 text-gray-400" />
                <span className="text-xs text-gray-300 truncate max-w-[150px]">{aud.name || 'Audio File'}</span>
              </div>
            ))}
          </div>
        )}

        {/* Main Response Text */}
        {cleanText && cleanText.trim() && (
          <p className="whitespace-pre-wrap leading-relaxed text-[15px] font-light tracking-wide">{linkify(cleanText)}</p>
        )}

        {/* Sources Section */}
        {message.sources && message.sources.length > 0 && (
          <div className="mt-3 pt-2 border-t border-white/10">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">🔍 Sources</p>
            <div className="flex flex-wrap gap-2">
              {message.sources.map((source, idx) => (
                <a
                  key={idx}
                  href={source.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full hover:bg-blue-500/20 transition-colors truncate max-w-[200px]"
                  title={source.uri}
                >
                  <span>🔗</span>
                  <span className="truncate">{source.title}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        <p className="text-[10px] text-gray-500 mt-1 font-medium tracking-wider">{message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
      </div>

      {/* Regenerate Action */}
      {onRegenerate && (
        <button
          onClick={() => onRegenerate(message)}
          className="mt-1 ml-1 p-1.5 text-gray-500 hover:text-white bg-transparent hover:bg-white/10 rounded-full transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
          title="Regenerate"
          aria-label="Regenerate response"
        >
          <RefreshIcon className="w-3 h-3" />
        </button>
      )}
    </div>
  );
};

// Memoize to prevent re-render when message hasn't changed
export default React.memo(MessageBubble, (prevProps, nextProps) => {
  // Only re-render if message content or callbacks changed
  // (Ignoring callbacks for deep equality if they are stable, but safer to just check content)
  // Ideally, callbacks should be stable via useCallback in parent.
  return prevProps.message.id === nextProps.message.id &&
    prevProps.message.text === nextProps.message.text &&
    prevProps.message.thinking === nextProps.message.thinking &&
    prevProps.message.sources?.length === nextProps.message.sources?.length &&
    prevProps.message.images?.length === nextProps.message.images?.length &&
    prevProps.message.audio?.length === nextProps.message.audio?.length &&
    prevProps.message.files?.length === nextProps.message.files?.length &&
    prevProps.onResend === nextProps.onResend &&
    prevProps.onRegenerate === nextProps.onRegenerate;
});