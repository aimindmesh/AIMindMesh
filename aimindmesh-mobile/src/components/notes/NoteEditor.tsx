import React, { useEffect, useState, useMemo } from "react";
import "@blocknote/core/fonts/inter.css";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { Block } from "@blocknote/core";
import { logger } from "../../services/logger";
import { LLMConfig, Personality } from "../../types";
import { generateTextResponseStream } from "../../services/llm/llmService";

interface NoteEditorProps {
    initialContent?: string;
    onSave?: (content: string) => Promise<void>;
    editable?: boolean;
    llmConfig?: LLMConfig;
    apiKey?: string;
    personality?: Personality;
}

export const NoteEditor: React.FC<NoteEditorProps> = ({
    initialContent,
    onSave,
    editable = true,
    llmConfig,
    apiKey,
    personality,
}) => {
    const [isSaving, setIsSaving] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);

    // Initialize editor
    const editor = useCreateBlockNote({
        initialContent: initialContent
            ? (JSON.parse(initialContent) as Block[])
            : undefined,
    });

    // Auto-save debouncer
    useEffect(() => {
        if (!editable || !onSave) return;

        let timeoutId: NodeJS.Timeout;

        const handleUpdate = () => {
            clearTimeout(timeoutId);
            setIsSaving(true);

            timeoutId = setTimeout(async () => {
                try {
                    const blocks = editor.document;
                    const jsonContent = JSON.stringify(blocks);
                    await onSave(jsonContent);
                    setIsSaving(false);
                } catch (error) {
                    logger.log('error', '[NoteEditor] Failed to save note', error);
                    setIsSaving(false);
                }
            }, 1000); // 1 second debounce
        };

        const cleanup = editor.onChange(handleUpdate);

        return () => {
            clearTimeout(timeoutId);
            cleanup();
        };
    }, [editor, editable, onSave]);

    // AI Generation Function
    // AI Generation Function
    const handleAIGeneration = async () => {
        if (!llmConfig || isGenerating) return;

        setIsGenerating(true);

        // Define newBlock in outer scope for error handling cleanup
        let newBlock: Block | undefined;

        try {
            const currentBlock = editor.getTextCursorPosition().block;
            const previousBlock = editor.document.indexOf(currentBlock) > 0
                ? editor.document[editor.document.indexOf(currentBlock) - 1]
                : null;

            // Context: Previous block + Current block text
            const contextText = (previousBlock ? (Array.isArray(previousBlock.content) ? previousBlock.content.map(c => c.type === 'text' ? c.text : '').join('') : '') + '\n' : '') +
                (Array.isArray(currentBlock.content) ? currentBlock.content.map(c => c.type === 'text' ? c.text : '').join('') : '');

            if (!contextText.trim()) {
                setIsGenerating(false);
                return;
            }

            const prompt = `Complete the following text or answer the question implied. Keep the formatting clean. \n\nContext:\n${contextText}`;

            // Create a placeholder block for streaming
            editor.insertBlocks(
                [{ type: "paragraph", content: "AI is thinking..." }],
                currentBlock,
                "after"
            );

            // Get the new block (it's the one after current)
            const newBlockIndex = editor.document.indexOf(currentBlock) + 1;
            newBlock = editor.document[newBlockIndex];

            let fullResponse = "";

            // Force a clean personality for note generation to avoid tool hallucinations from global prompt
            // Use passed personality name if available to satisfy TS unused var check
            const notePersonality: Personality = {
                name: personality?.name || 'Writer',
                description: 'A helpful writing assistant.',
                traits: [],
                // OVERRIDE system prompt completely to avoid global prompt leakage
                systemPrompt: 'You are a helpful writing assistant. Your task is to complete the text or answer the question provided in the context. \nIMPORTANT: Do NOT use tools. Do NOT use <thinking> tags. Just write the text directly.'
            };

            // Disable tools for simple note generation to avoid "no tool found" errors
            const noteGenerationConfig: LLMConfig = {
                ...llmConfig,
                enableToolCalling: false,
                enableSearch: false,
                enableThinking: false
            };

            const stream = generateTextResponseStream(
                [{ role: 'user', text: prompt, id: 'note-gen', timestamp: new Date() }],
                notePersonality,
                noteGenerationConfig,
                [],
                apiKey
            );

            for await (const chunk of stream) {
                let text = "";
                if (typeof chunk === 'string') text = chunk;
                else if (chunk.type === 'text') text = chunk.content;

                if (text) {
                    fullResponse += text;

                    // Filter out ALL xml tags (thinking/tool) if they leak through
                    // This prevents raw tags from appearing in the note
                    const cleanResponse = fullResponse
                        .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
                        .replace(/<tool>[\s\S]*?<\/tool>/g, '')
                        .trim();

                    if (cleanResponse && newBlock) {
                        editor.updateBlock(newBlock, {
                            content: cleanResponse
                        });
                    }
                }
            }

            // Cleanup if response was all filtered out (empty text after stripping tags)
            const finalClean = fullResponse
                .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
                .replace(/<tool>[\s\S]*?<\/tool>/g, '')
                .trim();

            if (!finalClean && newBlock) {
                // Try to remove the block using the reference
                editor.removeBlocks([newBlock]);
            }

        } catch (error) {
            logger.log('error', '[NoteEditor] AI Generation failed', error);

            // Remove the loading block on error
            if (newBlock) {
                try {
                    editor.removeBlocks([newBlock]);
                } catch (e) {
                    // ignore if already removed
                }
            }

        } finally {
            setIsGenerating(false);
        }
    };

    // Export to Markdown
    const handleExport = async () => {
        const markdown = await editor.blocksToMarkdownLossy(editor.document);
        // Download as file
        const blob = new Blob([markdown], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `note-${new Date().toISOString().split('T')[0]}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // Custom Dark Theme overrides
    const themeOverrides = useMemo(() => ({
        colors: {
            editor: {
                text: "var(--color-text-primary)",
                background: "transparent", // Transparent to show our app background
            },
        },
    }), []);

    return (
        <div className="note-editor-container relative h-full flex flex-col">
            {/* Toolbar / Status */}
            <div className="flex justify-between items-center mb-2 px-2">
                <div className={`text-xs text-gray-400 transition-opacity duration-300 ${isSaving ? 'opacity-100' : 'opacity-0'}`}>
                    💾 Saving...
                </div>

                {/* AI Button - Only show if config exists */}
                <div className="flex gap-2">
                    <button
                        onClick={handleExport}
                        className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-surface hover:bg-white/10 text-gray-300 transition-all border border-white/10"
                        title="Export as Markdown"
                    >
                        ⬇️ MD
                    </button>

                    {llmConfig && (
                        <button
                            onClick={handleAIGeneration}
                            disabled={isGenerating}
                            className={`
                            flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-all
                            ${isGenerating ? 'bg-primary/50 cursor-wait' : 'bg-primary/20 hover:bg-primary/30 text-primary-light'}
                        `}
                        >
                            {isGenerating ? (
                                <>
                                    <div className="animate-spin h-3 w-3 border-b-2 border-white rounded-full" />
                                    Thinking...
                                </>
                            ) : (
                                <>
                                    ✨ AI Assist
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0 flex flex-col">
                <BlockNoteView
                    editor={editor}
                    editable={editable}
                    theme={themeOverrides} // Use custom theme
                    className="flex-1 min-h-[500px]" // Allow it to grow
                    data-theming-css-variables // Enable CSS variables for easier overriding
                />
            </div>

            {/* CSS Overrides for deep integration */}
            <style>{`
        .mantine-Editor-root {
            background-color: transparent !important;
        }
        .bn-editor {
            background-color: transparent !important;
            color: var(--color-text-primary) !important;
        }
        /* Ensure inputs/modals in the editor are also visible */
        .bn-inline-content {
             color: var(--color-text-primary) !important;
        }
      `}</style>
        </div>
    );
};
