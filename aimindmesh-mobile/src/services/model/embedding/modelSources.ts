/**
 * What an imported embedding model really is: the `_name_or_path` of its config.json (e.g.
 * "intfloat/multilingual-e5-small" in a folder named "memories3"). Prefixes and similarity
 * thresholds depend on the model family, which a folder name does not tell.
 */
import { FileSystemAdapter as Filesystem, Directory, Encoding } from '../../../utils/fileSystemAdapter';
import { EMBEDDING_MODELS_DIR } from './types';

const sources = new Map<string, string>();

export function setModelSource(modelId: string, source: string | undefined): void {
    if (source) sources.set(modelId, source);
}

export function modelSource(modelId: string | undefined): string | undefined {
    return modelId ? sources.get(modelId) : undefined;
}

/** The model's config.json `_name_or_path`, when it has one */
export async function readModelSource(modelId: string): Promise<string | undefined> {
    try {
        const file = await Filesystem.readFile({ path: `${EMBEDDING_MODELS_DIR}/${modelId}/config.json`, directory: Directory.Data, encoding: Encoding.UTF8 });
        const name = JSON.parse(String(file.data))?._name_or_path;
        return typeof name === 'string' && name.trim() ? name.trim() : undefined;
    } catch {
        return undefined;
    }
}

const E5 = /(^|[^a-z0-9])e5([^a-z0-9]|$)/i;

/** E5 by its id (built-in or named so) or by its config */
export const isE5 = (modelId: string) => E5.test(modelId) || E5.test(modelSource(modelId) ?? '');
