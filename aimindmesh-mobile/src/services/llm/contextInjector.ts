import { DocumentRetriever } from '../documents/DocumentRetriever';
import { workspaceService } from '../workspaces/WorkspaceService';
import { logger } from '../logger';

export class ContextInjector {
    private retriever: DocumentRetriever;

    constructor() {
        this.retriever = new DocumentRetriever();
    }

    /**
     * enhance the system prompt with relevant document snippets
     */
    async buildSystemPromptWithContext(
        userQuery: string,
        baseSystemPrompt: string
    ): Promise<string> {
        const activeWorkspace = workspaceService.getActiveWorkspace();

        // Check if auto-inject is enabled for the active workspace
        if (!activeWorkspace || !activeWorkspace.settings.auto_inject) {
            return baseSystemPrompt;
        }

        try {
            // Retrieve relevant chunks
            const chunks = await this.retriever.autoRetrieve(userQuery);

            if (chunks.length === 0) {
                return baseSystemPrompt;
            }

            // Group chunks by document
            const grouped: Record<string, any[]> = {};
            chunks.forEach(c => {
                const title = c.document_title || `Doc ${c.document_id}`;
                if (!grouped[title]) grouped[title] = [];
                grouped[title].push(c);
            });

            // Build Context Block
            let contextBlock = `\n\n## 📚 WORKSPACE CONTEXT (${activeWorkspace.name})\n`;
            contextBlock += `Use the following document excerpts to answer the user's question. If the answer is found in the context, cite the document title. If not, rely on your general knowledge but mention that the documents didn't contain the answer.\n\n`;

            Object.entries(grouped).forEach(([title, docChunks]) => {
                contextBlock += `### 📄 ${title}\n`;
                docChunks.forEach(chunk => {
                    contextBlock += `(Page ${chunk.page_number || 'N/A'}) Score: ${chunk.score.toFixed(2)}\n`;
                    contextBlock += `"""\n${chunk.content.trim()}\n"""\n\n`;
                });
            });

            logger.log('info', `[ContextInjector] Injected ${chunks.length} chunks from ${Object.keys(grouped).length} documents.`);

            return baseSystemPrompt + contextBlock;

        } catch (error) {
            logger.log('error', '[ContextInjector] Failed to inject context', error);
            return baseSystemPrompt; // Fail safe
        }
    }
}

export const contextInjector = new ContextInjector();
