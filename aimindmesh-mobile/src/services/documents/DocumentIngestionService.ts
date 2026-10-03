import { DocumentParser } from './DocumentParser';
import { DocumentChunker, Chunk } from './DocumentChunker';
import { getKnowledgeDatabase, INGESTING_CHUNK_COUNT } from '../database/knowledgeDatabase';
import { FileSystemAdapter as Filesystem } from '../../utils/fileSystemAdapter';
import { logger } from '../logger';
import { readSetting } from '../security/secretStore';
import { embedText, ensureEmbeddingModel, ensureEmbeddingModelFromSettings, getActiveEmbeddingModel, getEmbeddingLoadError } from '../model/embedding/embeddingRuntime';
import { float32ToHex } from '../memory/embeddingCodec';
import { memoryTaskConfig } from '../memory/memoryLlmConfig';
import { generateTextResponseStream } from '../llm/llmService';
import { AIMindMeshServerSettings, LLMConfig, Personality } from '../../types';

export interface IngestionOptions {
    chunkSize?: number;
    chunkOverlap?: number;
    chunkingStrategy?: 'recursive' | 'page-level' | 'semantic';
    embeddingModelId?: string;
    mode?: 'STANDARD' | 'DEEP';
    localNeural?: boolean;
}

export interface IngestionResult {
    /** Local document id; -1 when the document is not stored locally */
    id: number;
    chunks: number;
    status: 'indexed' | 'failed';
    jobId?: string;
    /** Sent to the AIMindMesh server: no local row, nothing to link to a local workspace */
    remote?: boolean;
    /** DEEP mode: concepts extracted locally */
    concepts?: string[];
    error?: string;
}

/** Chunks written per transaction */
const CHUNK_INSERT_BATCH = 50;
/** DEEP mode: concepts come from at most this many chunks, spread over the document */
const MAX_CONCEPT_CHUNKS = 20;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Server settings as the app stores them (the API key lives in the secret store) */
function readServerSettings(): AIMindMeshServerSettings | null {
    const settings = readSetting<AIMindMeshServerSettings | null>('aimindmesh-server-settings', null);
    return settings && settings.enabled && settings.serverUrl ? settings : null;
}

/** Chat model settings and the API key of their provider */
function readLlmSettings(): { config: LLMConfig | null; apiKey?: string } {
    const config = readSetting<LLMConfig | null>('llm-config', null);
    if (!config) return { config: null };
    const keyName = config.provider === 'perplexity' ? 'perplexity-api-key'
        : config.provider === 'claude' ? 'claude-api-key' : 'gemini-api-key';
    return { config, apiKey: readSetting<string>(keyName, '') || undefined };
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
            // 0a. AIMindMesh Server Mode
            const server = readServerSettings();
            if (server && !options.localNeural) {
                logger.log('info', `[Ingestion] Routing to Server Ingestion (Mode: ${options.mode || 'STANDARD'})`);
                return await this.ingestToServer(filePath, metadata, server, options);
            }

            // 0b. Check Database Connection (Force Ping)
            await getKnowledgeDatabase();

            // 0c. Embedding model: the requested one, else the one selected in the settings
            const loaded = options.embeddingModelId
                ? await ensureEmbeddingModel(options.embeddingModelId)
                : (await ensureEmbeddingModelFromSettings()) || !!getActiveEmbeddingModel();
            if (!loaded) {
                const reason = getEmbeddingLoadError(options.embeddingModelId);
                throw new Error(`Embedding model not loaded${reason ? `: ${reason}` : ' (select one in Settings > Memory)'}`);
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
            if (chunks.length === 0) throw new Error('No text chunks extracted');
            logger.log('info', `[Ingestion] Created ${chunks.length} chunks`);

            // 4. Embedding Generation
            const { embeddings, key } = await this.generateEmbeddings(chunks);

            // 5. Storage (document finalized only once every chunk is written)
            const docId = await this.saveToDatabase(fileInfo, chunks, embeddings, metadata, key);

            // 6. Local Concept Extraction (Hybrid Neural): kept in the document metadata;
            //    ingestHybrid also sends them to the server job
            let concepts: string[] | undefined;
            if (options.mode === 'DEEP') {
                logger.log('info', '[Ingestion] Starting Local Concept Extraction...');
                concepts = await this.extractConcepts(chunks);
                logger.log('info', `[Ingestion] Extracted ${concepts.length} concepts locally`);
                if (concepts.length > 0) await this.storeConcepts(docId, metadata, concepts);
            }

            return { id: docId, chunks: chunks.length, status: 'indexed', concepts };
        } catch (error: any) {
            logger.log('error', '[Ingestion] Failed to ingest document', error);
            return { id: -1, chunks: 0, status: 'failed', error: error.message };
        }
    }

    /**
     * Specialized Hybrid Ingestion:
     * Ingest locally AND sync the locally extracted concepts to the server job.
     */
    async ingestHybrid(filePath: string, metadata: any = {}, options: IngestionOptions = {}): Promise<IngestionResult> {
        const server = readServerSettings();
        let serverJobId: string | undefined;

        // 1. If server is enabled, start server ingestion in STANDARD mode (DEEP is done locally)
        if (server) {
            const serverOptions = { ...options, mode: options.mode === 'DEEP' ? 'STANDARD' as const : options.mode };
            const serverRes = await this.ingestToServer(filePath, metadata, server, serverOptions);
            if (serverRes.status === 'indexed') serverJobId = serverRes.jobId;
            else logger.log('warn', '[Ingestion] Server-side branch of hybrid ingest failed', serverRes.error);
        }

        // 2. Local ingestion (parsing, embedding, concept extraction in DEEP mode)
        const result = await this.ingestDocument(filePath, metadata, { ...options, localNeural: true });

        // 3. The concepts extracted from the real text go to the server job (the local
        //    document id means nothing on the server)
        if (server && serverJobId && result.status === 'indexed' && result.concepts?.length) {
            await this.syncConceptsToServer(serverJobId, result.concepts, server);
        }

        return { ...result, jobId: serverJobId };
    }

    private async ingestToServer(filePath: string, metadata: any, serverSettings: AIMindMeshServerSettings, options: IngestionOptions = {}): Promise<IngestionResult> {
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

            // The document is indexed by the server job: there is no local row (id -1)
            return { id: -1, chunks: 0, status: 'indexed', jobId, remote: true };
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

    /** Passage embeddings of every chunk, all from the same model (its key is stored with them) */
    private async generateEmbeddings(chunks: Chunk[]): Promise<{ embeddings: Float32Array[]; key: string }> {
        const key = getActiveEmbeddingModel()?.key;
        if (!key) throw new Error('Embedding model not loaded');

        const embeddings: Float32Array[] = [];
        for (let i = 0; i < chunks.length; i++) {
            const { vector, key: usedKey } = await embedText(chunks[i].content, 'passage');
            if (usedKey !== key) throw new Error('The embedding model changed during ingestion');
            embeddings.push(vector);

            // Yield to event loop to avoid freezing UI
            if (i % 10 === 9) await sleep(50);
        }

        return { embeddings, key };
    }

    /**
     * The document row is marked "ingesting" (total_chunks = -1) until every chunk is written in
     * batched transactions. On failure it is deleted with its chunks; after an app kill the
     * next start removes it (initKnowledgeDatabase).
     */
    async saveToDatabase(
        fileInfo: any,
        chunks: Chunk[],
        embeddings: Float32Array[],
        metadata: any,
        modelKey: string
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
                INGESTING_CHUNK_COUNT,
                Date.now(),
                JSON.stringify(metadata)
            ]
        );

        const docId = docResult.changes?.lastId;
        if (!docId) throw new Error('Failed to insert document');

        try {
            for (let start = 0; start < chunks.length; start += CHUNK_INSERT_BATCH) {
                const set = chunks.slice(start, start + CHUNK_INSERT_BATCH).map((chunk, offset) => ({
                    statement: `INSERT INTO document_chunks (
            document_id, chunk_index, content, embedding,
            token_count, page_number, chunk_metadata, embedding_model
          ) VALUES (?, ?, ?, X'${float32ToHex(embeddings[start + offset])}', ?, ?, ?, ?)`,
                    values: [
                        docId,
                        chunk.chunk_index,
                        chunk.content,
                        Math.ceil(chunk.content.length / 4), // Rough token est
                        chunk.page_number ?? null,
                        JSON.stringify({}),
                        modelKey
                    ]
                }));
                await db.executeSet(set, true);
            }
            await db.run('UPDATE documents SET total_chunks = ? WHERE id = ?', [chunks.length, docId]);
        } catch (error) {
            // Never leave a half-written document (chunks go with it: ON DELETE CASCADE)
            await db.run('DELETE FROM documents WHERE id = ?', [docId])
                .catch(e => logger.log('warn', '[Ingestion] Could not remove partial document', e));
            throw error;
        }

        return docId;
    }

    /** Concepts of up to MAX_CONCEPT_CHUNKS chunks spread over the document (one LLM call each) */
    private async extractConcepts(chunks: Chunk[]): Promise<string[]> {
        const allConcepts = new Set<string>();
        const step = Math.max(1, Math.ceil(chunks.length / MAX_CONCEPT_CHUNKS));
        for (let i = 0; i < chunks.length; i += step) {
            const extracted = await this.extractConceptsLocally(chunks[i].content);
            extracted.forEach(c => allConcepts.add(c));
        }
        return Array.from(allConcepts);
    }

    private async storeConcepts(docId: number, metadata: any, concepts: string[]): Promise<void> {
        try {
            const db = await getKnowledgeDatabase();
            await db.run('UPDATE documents SET metadata = ? WHERE id = ?', [JSON.stringify({ ...metadata, concepts }), docId]);
        } catch (e) {
            logger.log('warn', '[Ingestion] Could not store concepts', e);
        }
    }

    private async extractConceptsLocally(text: string): Promise<string[]> {
        const prompt = `Extract exactly 5 key concepts, entities, or technical terms from this text.
        You MUST output ONLY a JSON array of strings. Do not include any explanation or markdown.
        Format: ["Concept1", "Concept2", "Concept3", "Concept4", "Concept5"]

        Text: ${text.slice(0, 1500)}`;

        const dummyPersonality: Personality = { name: 'Extractor', description: 'Concepts Extractor', systemPrompt: 'Return JSON', traits: [] };

        // Use configured settings for LLM selection
        const { config, apiKey } = readLlmSettings();
        if (!config) return [];

        try {
            let fullResponse = '';
            const history = [{ role: 'user' as const, text: prompt, id: 'ext-' + Date.now().toString(), timestamp: new Date() }];
            // generateTextResponseStream handles provider abstraction (LiteRT/GGUF/etc)
            for await (const chunk of generateTextResponseStream(history, dummyPersonality, memoryTaskConfig(config), [], apiKey, undefined, 256, undefined)) {
                if (typeof chunk === 'string') fullResponse += chunk;
                else if (chunk.type === 'text') fullResponse += chunk.content;
            }

            const match = fullResponse.match(/\[.*\]/s);
            if (match) {
                try {
                    const concepts = JSON.parse(match[0]);
                    return Array.isArray(concepts)
                        ? concepts.filter((c: unknown): c is string => typeof c === 'string' && c.trim().length > 0).slice(0, 5)
                        : [];
                } catch (e) {
                    return [];
                }
            }
        } catch (err) {
            logger.log('error', '[Ingestion] Local extraction failed', err);
        }
        return [];
    }

    private async syncConceptsToServer(jobId: string, concepts: string[], server: AIMindMeshServerSettings) {
        try {
            logger.log('info', `[Ingestion] Syncing ${concepts.length} concepts to server...`);
            const resp = await fetch(`${server.serverUrl}/api/documents/${jobId}/sync-concepts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': server.apiKey
                },
                body: JSON.stringify({ concepts })
            });
            if (resp.ok) {
                logger.log('info', '[Ingestion] Concepts synced successfully');
            } else {
                logger.log('warn', `[Ingestion] Concept sync failed: ${resp.status}`);
            }
        } catch (e) {
            logger.log('warn', '[Ingestion] Concept sync failed', e);
        }
    }
}
