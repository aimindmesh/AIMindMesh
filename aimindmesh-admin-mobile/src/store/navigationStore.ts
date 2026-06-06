import { create } from 'zustand';

export type TabId = 'cockpit' | 'quarantine' | 'stats' | 'logs' | 'ingest' | 'evolution' | 'settings' | 'kasm';

interface NavigationState {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
}

export const useNavigationStore = create<NavigationState>((set) => ({
  activeTab: 'cockpit',
  setActiveTab: (tab) => set({ activeTab: tab }),
}));
