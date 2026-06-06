import { create } from 'zustand';
import { Logger } from '../utils/logger';

interface UIState {
  activeTab: string;
  discussionContext: string | null;
  performanceMode: boolean;
  setActiveTab: (tab: string) => void;
  startDiscussion: (content: string) => void;
  clearDiscussion: () => void;
  setPerformanceMode: (enabled: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  activeTab: 'chat', // Default to chat
  discussionContext: null,
  performanceMode: false, // Default to beauty mode
  setActiveTab: (activeTab) => {
    Logger.debug('UIStore', `Navigation transition to: ${activeTab}`);
    set({ activeTab });
  },
  startDiscussion: (content) => {
    Logger.info('UIStore', `Initializing synaptic context for discussion: ${content.substring(0, 30)}...`);
    set({ activeTab: 'chat', discussionContext: content });
  },
  clearDiscussion: () => set({ discussionContext: null }),
  setPerformanceMode: (performanceMode) => {
    Logger.info('UIStore', `Performance mode toggled: ${performanceMode ? 'ENABLED' : 'DISABLED'}`);
    set({ performanceMode });
  },
}));
