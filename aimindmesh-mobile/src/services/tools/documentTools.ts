import { ToolDefinition } from './types';
import { DocumentIngestionService } from '../documents/DocumentIngestionService';
import { DocumentRetriever } from '../documents/DocumentRetriever';
import { getKnowledgeDatabase } from '../database/knowledgeDatabase';
import { Type } from '@google/genai';

const ingestionService = new DocumentIngestionService();
const retriever = new DocumentRetriever();

export const documentTools: ToolDefinition[] = [
    {
        name: 'search_documents',
        description: 'Search in uploaded documents using keywords and semantic meaning. Use this to find information in files.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                query: {
                    type: Type.STRING,
                    description: 'The search query or question'
                },
                top_k: {
                    type: Type.NUMBER,
                    description: 'Max results to return (default 5)'
                }
            },
            required: ['query']
        },
        requiresConfirmation: false,
        category: 'files',
        handler: async (params) => {
            // Auto-retrieve uses active workspace if set
            const results = await retriever.autoRetrieve(params.query);

            if (results.length === 0) {
                return 'No relevant documents found.';
            }

            return results.map(r =>
                `[Source: ${r.document_title || 'Doc ' + r.document_id} (Page ${r.page_number})] Score: ${r.score.toFixed(2)}\n${r.content}`
            ).join('\n\n');
        }
    },

    {
        name: 'ingest_document',
        description: 'Import and index a document (PDF, TXT, MD, DOCX) for future searches.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                file_path: {
                    type: Type.STRING,
                    description: 'Absolute path to the document file'
                }
            },
            required: ['file_path']
        },
        requiresConfirmation: false,
        category: 'files',
        handler: async (params: any) => {
            try {
                const result = await ingestionService.ingestDocument(params.file_path);
                if (result.status === 'failed') {
                    return `Failed to ingest document: ${result.error}`;
                }
                return `Successfully ingested document. ID: ${result.id}, Chunks: ${result.chunks}.`;
            } catch (e: any) {
                return `Error: ${e.message}`;
            }
        }
    },

    {
        name: 'list_documents',
        description: 'List all indexed documents and their metadata.',
        parameters: {
            type: Type.OBJECT,
            properties: {},
            required: []
        },
        requiresConfirmation: false,
        category: 'files',
        handler: async () => {
            const db = await getKnowledgeDatabase();
            const res = await db.query('SELECT id, title, filename, file_type, total_chunks, created_at FROM documents ORDER BY created_at DESC LIMIT 20');

            if (!res.values || res.values.length === 0) return 'No documents found.';

            return res.values.map(d =>
                `ID: ${d.id} | ${d.filename} (${d.file_type}) | Chunks: ${d.total_chunks} | Date: ${new Date(d.created_at).toLocaleDateString()}`
            ).join('\n');
        }
    }
];
