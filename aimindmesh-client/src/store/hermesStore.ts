import { create } from 'zustand';

export interface HermesMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface HermesState {
  available: boolean;
  version: string;
  consoleMessages: HermesMessage[];
  loading: boolean;
  configYaml: string;
  envFile: string;

  setAvailable: (v: boolean) => void;
  setVersion: (v: string) => void;
  addConsoleMessage: (msg: HermesMessage) => void;
  clearConsole: () => void;
  setLoading: (v: boolean) => void;
  setConfig: (configYaml: string, envFile: string) => void;
}

export const useHermesStore = create<HermesState>((set) => ({
  available: false,
  version: '',
  consoleMessages: [],
  loading: false,
  configYaml: '',
  envFile: '',

  setAvailable: (v) => set({ available: v }),
  setVersion: (v) => set({ version: v }),
  addConsoleMessage: (msg) =>
    set((s) => ({ consoleMessages: [...s.consoleMessages, msg] })),
  clearConsole: () => set({ consoleMessages: [] }),
  setLoading: (loading) => set({ loading }),
  setConfig: (configYaml, envFile) => set({ configYaml, envFile }),
}));
