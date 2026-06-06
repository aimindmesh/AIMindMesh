import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  serverUrl: string;
  apiKey: string;
  setServerUrl: (url: string) => void;
  setApiKey: (key: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      serverUrl: 'http://10.2.0.1:3030',
      apiKey: '',
      setServerUrl: (serverUrl) => set({ serverUrl }),
      setApiKey: (apiKey) => set({ apiKey }),
    }),
    { name: 'admin-settings' }
  )
);
