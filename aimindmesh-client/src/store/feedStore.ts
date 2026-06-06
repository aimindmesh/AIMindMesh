import { create } from 'zustand';

export interface Insight {
  id: string;
  text: string;
  timestamp: number;
  concepts: string[];
  unread: boolean;
}

interface FeedState {
  insights: Insight[];
  setInsights: (insights: Insight[]) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  addInsight: (insight: Insight) => void;
}

export const useFeedStore = create<FeedState>((set) => ({
  insights: [],
  setInsights: (insights) => set({ insights }),
  markAsRead: (id) => set((state) => ({
    insights: state.insights.map((i) => (i.id === id ? { ...i, unread: false } : i))
  })),
  markAllAsRead: () => set((state) => ({
    insights: state.insights.map((i) => ({ ...i, unread: false }))
  })),
  addInsight: (insight) => set((state) => ({
    insights: [insight, ...state.insights]
  })),
}));
