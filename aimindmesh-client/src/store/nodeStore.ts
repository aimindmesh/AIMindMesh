import { create } from 'zustand';
import { Logger } from '../utils/logger';

interface NodeState {
  status: 'ONLINE' | 'OFFLINE' | 'CONNECTING';
  ollamaRunning: boolean;
  ollamaModel: string | null;
  ollamaRamUsageMb: number | null;
  serverActiveModel: string | null;
  geminiCallsUsed: number;
  geminiCallsCap: number;
  lastProactiveCycle: { timestamp: number, generated: boolean, reason?: string } | null;
  
  setStatus: (status: 'ONLINE' | 'OFFLINE' | 'CONNECTING') => void;
  setOllamaState: (running: boolean, model: string | null, ram: number | null) => void;
  updateServerStatus: (data: Partial<NodeState>) => void;
}

export const useNodeStore = create<NodeState>((set) => ({
  status: 'CONNECTING',
  ollamaRunning: false,
  ollamaModel: null,
  ollamaRamUsageMb: null,
  serverActiveModel: null,
  geminiCallsUsed: 0,
  geminiCallsCap: 1500,
  lastProactiveCycle: null,

  setStatus: (status) => {
    Logger.debug('NodeStore', `Neural link status transitioned to: ${status}`);
    set({ status });
  },
  setOllamaState: (ollamaRunning, ollamaModel, ollamaRamUsageMb) => {
    if (ollamaRunning) Logger.debug('NodeStore', `Local engine pulse detected: ${ollamaModel} (${ollamaRamUsageMb}MB)`);
    set({ ollamaRunning, ollamaModel, ollamaRamUsageMb });
  },
  updateServerStatus: (data) => set((state) => ({ ...state, ...data })),
}));
