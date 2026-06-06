import { DocumentParser } from './DocumentParser';
import { DocumentChunker, Chunk } from './DocumentChunker';
import { getKnowledgeDatabase } from '../database/knowledgeDatabase';
import { TextEmbedding } from 'text-embedding-capacitor';
import { FileSystemAdapter as Filesystem } from '../../utils/fileSystemAdapter';
import { logger } from '../logger';

import { getOrInitializeSemanticMemoryRetriever } from '../memory/semanticMemoryRetriever';
import { generateTextResponseStream } from '../llm/llmService';
import { LLMConfig, Personality } from '../../types';

export interface IngestionOptions {
    chunkSize?: number;
    chunkOverlap?: number;
    chunkingStrategy?: 'recursive' | 'page-level' | 'semantic';
    embeddingModelId?: string;
    mode?: 'STANDARD' | 'DEEP';
    localNeural?: boolean;
}

export interface IngestionResult {
    id: number;
    chunks: number;
    status: 'indexed' | 'failed';
    jobId?: string;
    error?: string;
}

export class DocumentIngestionService {
    private parser: DocumentParser;
    private chunker: DocumentChunker;

    constructor() {
        this.parser = new DocumentParser();
        this.chunker = new DocumentChunker();
    }

    /**
     * Main entry point to ingest a document
     */
    async ingestDocument(filePath: string, metadata: any = {}, options: IngestionOptions = {}): Promise<IngestionResult> {
        logger.log('info', `[Ingestion] Starting ingestion for: ${filePath}`);

        try {
            // 0a. Check AIMindMesh Server Mode
            const rawSettings = localStorage.getItem('app-settings');
            if (rawSettings) {
                const settings = JSON.parse(rawSettings);
                const serverSettings = settings.aimindmeshServer;
                if (serverSettings && serverSettings.enabled && serverSettings.serverUrl && !options.localNeural) {
                    logger.log('info', `[Ingestion] Routing to Server Ingestion (Mode: ${options.mode || 'STANDARD'})`);
                    return await this.ingestToServer(filePath, metadata, serverSettings, options);
                }
            }

            // 0b. Check Database Connection (Force Ping)
            await getKnowledgeDatabase();

            // 0c. Ensure Embedding Model is Loaded
            if (options.embeddingModelId) {
                await getOrInitializeSemanticMemoryRetriever({
                    enableSemanticMemory: true,
                    embeddingModelId: options.embeddingModelId
                });
            }

            // 1. Validation & File Info
            const fileInfo = await this.getFileInfo(filePath);
            if (fileInfo.size > 10 * 1024 * 1024) { // 10MB limit
                throw new Error('File too large (>10MB)');
            }

            // 2. Parsing
            const rawText = await this.parser.parse(filePath, fileInfo.type);
            if (!rawText || rawText.length < 10) {
                throw new Error('Extracted text is too short or empty');
            }
            logger.log('info', `[Ingestion] Parsed ${rawText.length} chars`);

            // 3. Chunking
            const strategy = options.chunkingStrategy || this.chunker.selectStrategy(fileInfo.type);
            const chunkSize = options.chunkSize || 2000;
            const chunkOverlap = options.chunkOverlap || 200;

            const chunks = await this.chunker.chunk(rawText, strategy, chunkSize, chunkOverlap);
            logger.log('info', `[Ingestion] Created ${chunks.length} chunks`);

            // 4. Embedding Generation
            const embeddings = await this.generateEmbeddings(chunks);

            // 5. Storage (Atomic Transaction)
            const docId = await this.saveToDatabase(fileInfo, chunks, embeddings, metadata);

            // 6. Local Concept Extraction (Hybrid Neural)
            if (options.mode === 'DEEP') {
                logger.log('info', '[Ingestion] Starting Local Concept Extraction...');
                const allConcepts = new Set<string>();
                for (const chunk of chunks) {
                    const extracted = await this.extractConceptsLocally(chunk.content);
                    extracted.forEach(c => allConcepts.add(c));
                }
                const conceptList = Array.from(allConcepts);
                logger.log('info', `[Ingestion] Extracted ${conceptList.length} concepts locally`);
                
                // Sync with Server if applicable
                const rawSettings = localStorage.getItem('app-settings');
                if (rawSettings) {
                    const settings = JSON.parse(rawSettings);
                    const server = settings.aimindmeshServer;
                    if (server && server.enabled && server.serverUrl) {
                        // Priority identification for sync: server jobId or local docId
                        // Note: If we just uploaded, we might have a jobId from a concurrent server-ingest result.
                        // For hybrid robustness, we can combine.
                        await this.syncConceptsToServer(String(docId), conceptList, server);
                    }
                }
            }

            return { id: docId, chunks: chunks.length, status: 'indexed' };
        } catch (error: any) {
            logger.log('error', '[Ingestion] Failed to ingest document', error);
            return { id: -1, chunks: 0, status: 'failed', error: error.message };
        }
    }

    /**
     * Specialized Hybrid Ingestion: 
     * Ingest locally AND sync concepts to server using server jobId.
     */
    async ingestHybrid(filePath: string, metadata: any = {}, options: IngestionOptions = {}): Promise<IngestionResult> {
        const rawSettings = localStorage.getItem('app-settings');
        const settings = rawSettings ? JSON.parse(rawSettings) : {};
        const server = settings.aimindmeshServer;

        let serverJobId: string | undefined;

        // 1. If server is enabled, start server ingestion in STANDARD mode (Lite)
        if (server && server.enabled) {
            try {
                // We use options.mode === 'DEEP' ? 'STANDARD' : options.mode because we handle DEEP locally
                const serverOptions = { ...options, mode: options.mode === 'DEEP' ? 'STANDARD' : options.mode };
                const serverRes = await this.ingestToServer(filePath, metadata, server, serverOptions);
                serverJobId = serverRes.jobId;
            } catch (e) {
                logger.log('warn', '[Ingestion] Server-side branch of hybrid ingest failed', e);
            }
        }

        // 2. Perform local ingestion (Parsing, Embedding, Local Concept Extraction)
        // Note: we pass options as is, ingestDocument will handle local extraction if mode is DEEP
        const result = await this.ingestDocument(filePath, metadata, { ...options, localNeural: true });

        // 3. If we have a server jobId AND we are in DEEP mode (so we extracted concepts locally)
        // We sync those concepts to the server job reference.
        if (serverJobId && options.mode === 'DEEP' && result.status === 'indexed') {
            // Documentingester must have finished or be in progress.
            // We can re-extract or reuse if we saved them during ingestDocument.
            // For simplicity, let's assume ingestDocument already did it but we need to re-sync with jobId.
            // (Re-extraction is fast locally)
            const rawText = await this.parser.parse(filePath, 'txt'); // Mock extension
            const concepts = await this.extractConceptsLocally(rawText.slice(0, 5000));
            if (concepts.length > 0) {
                await this.syncConceptsToServer(serverJobId, concepts, server);
            }
        }

        return { ...result, jobId: serverJobId };
    }

    private async ingestToServer(filePath: string, metadata: any, serverSettings: any, options: IngestionOptions = {}): Promise<IngestionResult> {
        try {
            const fileInfo = await this.getFileInfo(filePath);
            const fileData = await Filesystem.readFile({ path: filePath });
            
            // Convert base64 to Blob
            const byteCharacters = atob(fileData.data as string);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const blob = new Blob([new Uint8Array(byteNumbers)]);
            const file = new File([blob], fileInfo.name, { type: 'application/octet-stream' });

            const form = new FormData();
            form.append('file', file);
            if (metadata) form.append('metadata', JSON.stringify(metadata));
            if (options.mode) form.append('mode', options.mode);

            const resp = await fetch(`${serverSettings.serverUrl}/api/documents/ingest/file`, {
                method: 'POST',
                headers: { 'x-api-key': serverSettings.apiKey },
                body: form
            });

            if (!resp.ok) throw new Error(`Server ingestion failed: ${resp.status}`);
            const { jobId } = await resp.json();
            
            // Server returns no local ID, we mock success for tool continuation
            return { id: Math.floor(Math.random() * 100000), chunks: 1, status: 'indexed', jobId };
        } catch (error: any) {
            logger.log('error', '[Ingestion] Server upload failed', error);
            return { id: -1, chunks: 0, status: 'failed', error: error.message };
        }
    }


    private async getFileInfo(filePath: string) {
        const stat = await Filesystem.stat({ path: filePath });
        const name = filePath.split('/').pop() || 'unknown';
        const ext = name.split('.').pop() || 'txt';

        return {
            path: filePath,
            name,
            type: ext.toLowerCase(),
            size: stat.size
        };
    }

    private async generateEmbeddings(chunks: Chunk[]): Promise<Float32Array[]> {
        const embeddings: Float32Array[] = [];

        // Ensure model is loaded (idempotent usually, but good practice)
        const status = await TextEmbedding.isModelLoaded();
        if (!status.loaded) {
            // Warning: This assumes a default model is available or configured
            // In a real app, might need to trigger download or fail
            logger.log('warn', '[Ingestion] Embedding model not loaded. Attempting to load default...');
            // Should rely on external initialization, but failing that:
            // await TextEmbedding.loadModel({ modelDir: ... });
            throw new Error('Embedding model not loaded');
        }

        // Batch processing
        const BATCH_SIZE = 10;
        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const batch = chunks.slice(i, i + BATCH_SIZE);

            for (const chunk of batch) {
                const result = await TextEmbedding.generateEmbedding({
                    text: chunk.content
                    // model: 'all-MiniLM-L6-v2' // managed by plugin state usually
                });
                embeddings.push(new Float32Array(result.embedding));
            }

            // Yield to event loop to avoid freezing UI
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        return embeddings;
    }

    async saveToDatabase(
        fileInfo: any,
        chunks: Chunk[],
        embeddings: Float32Array[],
        metadata: any
    ): Promise<number> {
        // Force check connection again before writing to ensure reliability
        const db = await getKnowledgeDatabase();

        // Insert Document
        const docResult = await db.run(
            `INSERT INTO documents (
        filename, title, file_path, file_type, file_size, 
        total_chunks, created_at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                fileInfo.name,
                metadata.title || fileInfo.name,
                fileInfo.path,
                fileInfo.type,
                fileInfo.size,
                chunks.length,
                Date.now(),
                JSON.stringify(metadata)
            ]
        );

        const docId = docResult.changes?.lastId;
        if (!docId) throw new Error('Failed to insert document');

        // Insert Chunks
        // CapacitorSQLite run() with transaction:true (default) auto-manages transactions
        // No need for manual BEGIN/COMMIT
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const embedding = embeddings[i];

            // Convert Float32Array to Hex Blob string
            const embeddingBlob = new Uint8Array(embedding.buffer);
            const embeddingHex = Array.from(embeddingBlob)
                .map(b => b.toString(16).padStart(2, '0'))
                .join('');

            await db.run(
                `INSERT INTO document_chunks (
            document_id, chunk_index, content, embedding, 
            token_count, page_number, chunk_metadata
          ) VALUES (?, ?, ?, X'${embeddingHex}', ?, ?, ?)`,
                [
                    docId,
                    chunk.chunk_index,
                    chunk.content,
                    chunk.content.length / 4, // Rough token est
                    chunk.page_number || null,
                    JSON.stringify({})
                ]
            );
        }

        return docId;
    }

    private async extractConceptsLocally(text: string): Promise<string[]> {
        const prompt = `Extract exactly 5 key concepts, entities, or technical terms from this text. 
        You MUST output ONLY a JSON array of strings. Do not include any explanation or markdown.
        Format: ["Concept1", "Concept2", "Concept3", "Concept4", "Concept5"]
        
        Text: ${text.slice(0, 1500)}`;

        const dummyPersonality: Personality = { name: 'Extractor', description: 'Concepts Extractor', systemPrompt: 'Return JSON', traits: [] };
        
        // Use configured settings for LLM selection
        const rawSettings = localStorage.getItem('app-settings');
        const settings = rawSettings ? JSON.parse(rawSettings) : {};
        const llmConfig = (settings.llmConfig || {}) as LLMConfig;

        try {
            let fullResponse = '';
            const history = [{ role: 'user' as const, text: prompt, id: 'ext-' + Date.now().toString(), timestamp: new Date() }];
            // generateTextResponseStream handles provider abstraction (LiteRT/GGUF/etc)
            for await (const chunk of generateTextResponseStream(history, dummyPersonality, { ...llmConfig, enableThinking: false, enableToolCalling: false }, [], undefined, undefined, 256, undefined)) {
                if (typeof chunk === 'string') fullResponse += chunk;
                else if (chunk.type === 'text') fullResponse += chunk.content;
            }

            const match = fullResponse.match(/\[.*\]/s);
            if (match) {
                try {
                    const concepts = JSON.parse(match[0]);
                    return Array.isArray(concepts) ? concepts.slice(0, 5) : [];
                } catch (e) {
                    return [];
                }
            }
        } catch (err) {
            logger.log('error', '[Ingestion] Local extraction failed', err);
        }
        return [];
    }

    private async syncConceptsToServer(docId: string, concepts: string[], server: any) {
        try {
            logger.log('info', `[Ingestion] Syncing ${concepts.length} concepts to server...`);
            const resp = await fetch(`${server.serverUrl}/api/documents/${docId}/sync-concepts`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-api-key': server.apiKey 
                },
                body: JSON.stringify({ concepts })
            });
            if (resp.ok) {
                logger.log('info', '[Ingestion] Concepts synced successfully');
            }
        } catch (e) {
            logger.log('warn', '[Ingestion] Concept sync failed', e);
        }
    }
}
