import { DocumentRetriever } from '../documents/DocumentRetriever';
import { workspaceService } from '../workspaces/WorkspaceService';
import { getKnowledgeDatabase } from '../database/knowledgeDatabase';
import { logger } from '../logger';

/** Whether any document is indexed: global mode would otherwise embed every query for nothing */
async function hasIndexedDocuments(): Promise<boolean> {
    try {
        const db = await getKnowledgeDatabase();
        const res = await db.query('SELECT 1 FROM documents LIMIT 1');
        return (res.values?.length ?? 0) > 0;
    } catch {
        return false;
    }
}

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
        if (!userQuery?.trim()) return baseSystemPrompt;

        try {
            // The mode (all documents / one workspace / none) is loaded lazily from the database
            await workspaceService.ensureInitialized();
            const mode = workspaceService.getContextMode();
            const activeWorkspace = workspaceService.getActiveWorkspace();

            if (mode === 'NONE') return baseSystemPrompt;
            if (mode === 'WORKSPACE' && activeWorkspace) {
                // A workspace injects only when its auto-inject setting is on
                if (!activeWorkspace.settings.auto_inject) return baseSystemPrompt;
            } else if (!(await hasIndexedDocuments())) {
                // GLOBAL (or a workspace that is gone): search all documents, if there are any
                return baseSystemPrompt;
            }

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
            const scope = mode === 'WORKSPACE' && activeWorkspace ? activeWorkspace.name : 'All documents';
            let contextBlock = `\n\n## 📚 WORKSPACE CONTEXT (${scope})\n`;
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
