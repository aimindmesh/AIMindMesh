import { create } from 'zustand';

export interface CronJob {
  id: string;
  schedule: string;
  task: string;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
}

export interface Skill {
  name: string;
  version: string;
  description: string;
  trigger: string;
}

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  sessionKey?: string;
}

interface OpenClawState {
  available: boolean;
  version: string;
  skills: Skill[];
  cronJobs: CronJob[];
  consoleMessages: AgentMessage[];
  activeSession: string;
  loading: boolean;
  configFiles: Record<string, string>;

  setAvailable: (v: boolean) => void;
  setVersion: (v: string) => void;
  setSkills: (skills: Skill[]) => void;
  setCronJobs: (jobs: CronJob[]) => void;
  addConsoleMessage: (msg: AgentMessage) => void;
  clearConsole: () => void;
  setActiveSession: (key: string) => void;
  setLoading: (v: boolean) => void;
  setConfigFile: (filename: string, content: string) => void;
}

export const useOpenClawStore = create<OpenClawState>((set) => ({
  available: false,
  version: '',
  skills: [],
  cronJobs: [],
  consoleMessages: [],
  activeSession: 'laptop',
  loading: false,
  configFiles: {},

  setAvailable: (v) => set({ available: v }),
  setVersion: (v) => set({ version: v }),
  setSkills: (skills) => set({ skills }),
  setCronJobs: (cronJobs) => set({ cronJobs }),
  addConsoleMessage: (msg) =>
    set((s) => ({ consoleMessages: [...s.consoleMessages, msg] })),
  clearConsole: () => set({ consoleMessages: [] }),
  setActiveSession: (activeSession) => set({ activeSession }),
  setLoading: (loading) => set({ loading }),
  setConfigFile: (filename, content) =>
    set((s) => ({ configFiles: { ...s.configFiles, [filename]: content } })),
}));
