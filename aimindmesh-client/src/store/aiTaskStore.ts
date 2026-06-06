/**
 * aiTaskStore.ts
 *
 * Zustand store per AI Tasks.
 * Tiene la lista task, lo stato di loading, il task selezionato
 * e le esecuzioni del task corrente.
 */

import { create } from 'zustand';
import { aiTaskService } from '../services/aiTaskService';
import { ServerAiTask, AiTaskExecution, AiTaskCreatePayload, AiTaskUpdatePayload } from '../types/aiTask';

interface AiTaskState {
  tasks:           ServerAiTask[];
  selectedTask:    ServerAiTask | null;
  executions:      AiTaskExecution[];
  isLoading:       boolean;
  isLoadingExec:   boolean;
  error:           string | null;

  // Actions
  loadTasks:       () => Promise<void>;
  selectTask:      (task: ServerAiTask | null) => void;
  loadExecutions:  (taskId: string) => Promise<void>;
  createTask:      (payload: AiTaskCreatePayload) => Promise<ServerAiTask>;
  updateTask:      (taskId: string, payload: AiTaskUpdatePayload) => Promise<void>;
  deleteTask:      (taskId: string) => Promise<void>;
  pauseTask:       (taskId: string) => Promise<void>;
  resumeTask:      (taskId: string) => Promise<void>;
  runNow:          (taskId: string) => Promise<void>;
  approveExecution:(taskId: string, execId: string) => Promise<void>;
  clearError:      () => void;
}

export const useAiTaskStore = create<AiTaskState>((set, get) => ({
  tasks:          [],
  selectedTask:   null,
  executions:     [],
  isLoading:      false,
  isLoadingExec:  false,
  error:          null,

  loadTasks: async () => {
    set({ isLoading: true, error: null });
    try {
      const tasks = await aiTaskService.listTasks();
      set({ tasks, isLoading: false });
    } catch (e: any) {
      set({ isLoading: false, error: e.message ?? 'Failed to load tasks' });
    }
  },

  selectTask: (task) => {
    set({ selectedTask: task, executions: [] });
    if (task) get().loadExecutions(task.id);
  },

  loadExecutions: async (taskId) => {
    set({ isLoadingExec: true });
    try {
      const executions = await aiTaskService.listExecutions(taskId);
      set({ executions, isLoadingExec: false });
    } catch (e: any) {
      set({ isLoadingExec: false, error: e.message });
    }
  },

  createTask: async (payload) => {
    const newTask = await aiTaskService.createTask(payload);
    set(state => ({ tasks: [newTask, ...state.tasks] }));
    return newTask;
  },

  updateTask: async (taskId, payload) => {
    const updated = await aiTaskService.updateTask(taskId, payload);
    set(state => ({
      tasks: state.tasks.map(t => t.id === taskId ? updated : t),
      selectedTask: state.selectedTask?.id === taskId ? updated : state.selectedTask,
    }));
  },

  deleteTask: async (taskId) => {
    await aiTaskService.deleteTask(taskId);
    set(state => ({
      tasks: state.tasks.filter(t => t.id !== taskId),
      selectedTask: state.selectedTask?.id === taskId ? null : state.selectedTask,
    }));
  },

  pauseTask: async (taskId) => {
    await aiTaskService.pauseTask(taskId);
    set(state => ({
      tasks: state.tasks.map(t => t.id === taskId ? { ...t, status: 'paused' as const } : t),
    }));
  },

  resumeTask: async (taskId) => {
    await aiTaskService.resumeTask(taskId);
    set(state => ({
      tasks: state.tasks.map(t => t.id === taskId ? { ...t, status: 'active' as const } : t),
    }));
  },

  runNow: async (taskId) => {
    await aiTaskService.runNow(taskId);
    // Aggiorna optimisticamente lo stato visivo
    set(state => ({
      tasks: state.tasks.map(t => t.id === taskId
        ? {
          ...t,
          lastExecution: {
            executionId: 'pending',
            taskId,
            status: 'running' as const,
            startedAt: Date.now(),
            updatedAt: Date.now(),
          }
        }
        : t
      ),
    }));
  },

  approveExecution: async (taskId, execId) => {
    await aiTaskService.approveExecution(taskId, execId);
    set(state => ({
      executions: state.executions.map(e =>
        e.executionId === execId ? { ...e, status: 'completed' as const } : e
      ),
    }));
  },

  clearError: () => set({ error: null }),
}));
