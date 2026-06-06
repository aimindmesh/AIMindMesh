import { listen } from '@tauri-apps/api/event';
import { useNodeStore } from '../store/nodeStore';
import { useUIStore } from '../store/uiStore';
import { Logger } from '../utils/logger';

interface OllamaStatusEvent {
  running: boolean;
  model: string | null;
  ram_usage_mb: number | null;
}

interface NodeStatusEvent {
  status: 'ONLINE' | 'OFFLINE' | 'CONNECTING';
}

export function initTauriEvents() {
  listen<OllamaStatusEvent>('ollama-status-changed', (event) => {
    useNodeStore.getState().setOllamaState(
      event.payload.running,
      event.payload.model,
      event.payload.ram_usage_mb
    );
  });

  listen<NodeStatusEvent>('node-status-changed', (event) => {
    useNodeStore.getState().setStatus(event.payload.status);
  });

  listen<string>('navigate', (event) => {
    Logger.info('TauriEvents', `Remote navigation request: ${event.payload}`);
    // Mappa i path se necessario
    const tab = event.payload.replace('/', '');
    useUIStore.getState().setActiveTab(tab);
  });
}
