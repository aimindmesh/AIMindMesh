import { CustomGGUFModel } from '../../types';
import { logger } from '../logger';

const DB_NAME = 'AIMindMeshModels';
const DB_VERSION = 1;
const STORE_NAME = 'customModels';

/**
 * Service for managing storage of custom GGUF models using IndexedDB
 */
class ModelStorageService {
    private db: IDBDatabase | null = null;

    /**
     * Initialize the IndexedDB database
     */
    private async initDB(): Promise<IDBDatabase> {
        if (this.db) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => {
                logger.log('error', 'Failed to open IndexedDB', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve(request.result);
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                // Create object store for custom models if it doesn't exist
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    objectStore.createIndex('uploadedAt', 'uploadedAt', { unique: false });
                }
            };
        });
    }

    /**
     * Save a custom model's metadata to IndexedDB
     */
    async saveModelMetadata(model: CustomGGUFModel): Promise<void> {
        try {
            const db = await this.initDB();
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const objectStore = transaction.objectStore(STORE_NAME);

            await new Promise<void>((resolve, reject) => {
                const request = objectStore.put(model);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });

            logger.log('info', 'Model metadata saved', { modelId: model.id });
        } catch (error) {
            logger.log('error', 'Failed to save model metadata', error);
            throw error;
        }
    }

    /**
     * Get all custom models from storage
     */
    async getCustomModels(): Promise<CustomGGUFModel[]> {
        try {
            const db = await this.initDB();
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const objectStore = transaction.objectStore(STORE_NAME);

            return new Promise((resolve, reject) => {
                const request = objectStore.getAll();
                request.onsuccess = () => {
                    const models = request.result as CustomGGUFModel[];
                    // Convert Date strings back to Date objects
                    const parsedModels = models.map(m => ({
                        ...m,
                        uploadedAt: new Date(m.uploadedAt)
                    }));
                    resolve(parsedModels);
                };
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            logger.log('error', 'Failed to get custom models', error);
            return [];
        }
    }

    /**
     * Delete a custom model from storage
     */
    async deleteModel(modelId: string): Promise<void> {
        try {
            const db = await this.initDB();
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const objectStore = transaction.objectStore(STORE_NAME);

            await new Promise<void>((resolve, reject) => {
                const request = objectStore.delete(modelId);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });

            logger.log('info', 'Model deleted', { modelId });
        } catch (error) {
            logger.log('error', 'Failed to delete model', error);
            throw error;
        }
    }

    /**
     * Get total storage size used by custom models
     */
    async getTotalStorageSize(): Promise<number> {
        try {
            const models = await this.getCustomModels();
            return models.reduce((total, model) => total + model.sizeBytes, 0);
        } catch (error) {
            logger.log('error', 'Failed to calculate storage size', error);
            return 0;
        }
    }

    /**
     * Clear all custom models (for testing/reset purposes)
     */
    async clearAll(): Promise<void> {
        try {
            const db = await this.initDB();
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const objectStore = transaction.objectStore(STORE_NAME);

            await new Promise<void>((resolve, reject) => {
                const request = objectStore.clear();
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });

            logger.log('info', 'All custom models cleared');
        } catch (error) {
            logger.log('error', 'Failed to clear models', error);
            throw error;
        }
    }
}

// Export singleton instance
export const modelStorage = new ModelStorageService();
