import { makeAutoObservable, runInAction } from 'mobx';
import { initNativeModel, unloadNativeModelSlot, ModelSlot, getSlotModelInfo } from '../services/llm/nativeLLM';

export interface Model {
  id: string;
  name: string;
  path: string;
  size: number;
}

class ModelStore {
  activeChatModel: Model | null = null;
  activeToolModel: Model | null = null;
  isInitializing: boolean = false;
  error: string | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  async initContext(model: Model, slot: ModelSlot = 'chat') {
    runInAction(() => {
      this.isInitializing = true;
      this.error = null;
    });

    try {
      console.log(`[ModelStore] Initializing ${slot} model: ${model.name}`);
      await initNativeModel({
        modelPath: model.path,
        nThreads: 6, // Optimizing for Z Fold
        useMmap: true,
        useOpenCL: true, // Use Adreno GPU by default
      }, slot);

      runInAction(() => {
        if (slot === 'chat') {
          this.activeChatModel = model;
        } else if (slot === 'tool') {
          this.activeToolModel = model;
        }
        this.isInitializing = false;
      });
    } catch (e: any) {
      runInAction(() => {
        this.error = e.message;
        this.isInitializing = false;
      });
      throw e;
    }
  }

  async releaseContext(slot: ModelSlot = 'chat') {
    try {
      await unloadNativeModelSlot(slot);
      runInAction(() => {
        if (slot === 'chat') {
          this.activeChatModel = null;
        } else if (slot === 'tool') {
          this.activeToolModel = null;
        }
      });
    } catch (e: any) {
      console.error(`[ModelStore] Failed to release ${slot}:`, e);
    }
  }

  isLoaded(slot: ModelSlot = 'chat'): boolean {
    return getSlotModelInfo(slot).isLoaded;
  }
}

export const modelStore = new ModelStore();
