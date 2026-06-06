import React, { useState } from 'react';
import { Settings, Personality, Memory } from '../../types';
import { CloseIcon } from '../../constants';
import { triggerHaptic } from '../../services/native';
import { Clipboard } from '@capacitor/clipboard';
import { useSettingsState } from '../../hooks/useSettingsState';
import { FileSystemAdapter as Filesystem, Directory, Encoding } from '../../utils/fileSystemAdapter';
import { version } from '../../../package.json';
import { AgendaSettings as AgendaSettingsType, DEFAULT_AGENDA_SETTINGS } from '../../services/calendar/calendarService';
import { DOCUMENTATION_CONTENT } from '../../data/DocumentationData';

// Sub-components
import PersonalitySettings from './agent/PersonalitySettings';
import LLMSettings from './llm/LLMSettings';
import STTSettings from './audio/STTSettings';
import TTSSettings from './audio/TTSSettings';
import SpeakerSettings from './audio/SpeakerSettings';
import MemorySettings from './memory/MemorySettings';
import WakeWordSettings from './wakeword/WakeWordSettings';
import AgendaSettings from './system/AgendaSettings';
import AppSettings from './system/AppSettings';
import AgenticSettings from './agent/AgenticSettings';
import LogViewer from './system/LogViewer';
import VisionSettings from './vision/VisionSettings';
import { KnowledgeSettings } from './knowledge/KnowledgeSettings';
import SetupSettings from './system/SetupSettings';
import ThemeSettings, { applyTheme, getThemeColors } from './system/ThemeSettings';
import { FileStorageManager } from './system/FileStorageManager';
import AndroidAutoSettings from './AndroidAutoSettings';
import ProactiveSettings from './proactive/ProactiveSettings';
import AIMindMeshServerSettingsPanel from './llm/AIMindMeshServerSettingsPanel';
import SettingsSidebar from './layout/SettingsSidebar';
import SettingsMobileTabs from './layout/SettingsMobileTabs';
import SettingsDocumentation from './system/SettingsDocumentation';
import LinkDialog from './layout/LinkDialog';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  onSave: (newSettings: Settings) => void;
  memories: Memory[];
  onAddMemory: (content: string, category?: string) => void;
  onDeleteMemory: (id: string) => void;
  onClearMemories: () => void;
  memoryCategories: string[];
  onAddMemoryCategory: (category: string) => void;
  onDeleteMemoryCategory: (category: string) => void;
  onUpdateMemoryCategory: (id: string, newCategory: string) => void;
  onExportMemories: () => Promise<void>;
  onImportMemories: () => Promise<void>;
  onClearChatHistory: () => void;
  customPersonalities: Record<string, Personality>;
  onSaveCustomPersonality: (id: string, personality: Personality) => void;
  onDeleteCustomPersonality: (id: string) => void;
  agendaSettings?: AgendaSettingsType;
  onAgendaSettingsChange?: (settings: AgendaSettingsType) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = (props) => {
  const {
    isOpen, onClose, settings, onSave, memories, onAddMemory, onDeleteMemory,
    onClearMemories, memoryCategories, onAddMemoryCategory, onDeleteMemoryCategory,
    onUpdateMemoryCategory, onExportMemories, onImportMemories, onClearChatHistory,
    customPersonalities, onSaveCustomPersonality, onDeleteCustomPersonality,
    agendaSettings = DEFAULT_AGENDA_SETTINGS, onAgendaSettingsChange
  } = props;

  const s = useSettingsState(
    isOpen,
    settings,
    onSave,
    onClose,
    customPersonalities,
    (pcs) => {
      // Diff and call individual save/delete if needed, or better:
      // Since App.tsx uses setCustomPersonalities, we can just call it once if we add it to props.
      // For now, I'll use a hack to call the individual ones if I must, 
      // but I'll check if I can add onCustomPersonalitiesChange to SettingsModal.
      // Actually, I'll just use the ones provided.
      Object.entries(pcs).forEach(([id, p]) => onSaveCustomPersonality(id, p));
      Object.keys(customPersonalities).forEach(id => {
        if (!pcs[id]) onDeleteCustomPersonality(id);
      });
    },
    agendaSettings,
    onAgendaSettingsChange || (() => { }),
    (voices) => {
      localStorage.setItem('external_piper_voices', JSON.stringify(voices));
    }
  );
  const [activeTab, setActiveTab] = useState<'setup' | 'personality' | 'llm' | 'vision' | 'knowledge' | 'stt' | 'wakeword' | 'tts' | 'speaker' | 'memory' | 'agenda' | 'agentic' | 'proactive' | 'app' | 'theme' | 'log' | 'docs' | 'storage' | 'auto' | 'aimindmesh-server'>('personality');

  // UI state for global link dialog
  const [linkDialog, setLinkDialog] = useState({ show: false, title: '', urls: [] as { label: string, url: string }[] });

  const handleShowLink = (title: string, urls: { label: string, url: string }[]) => {
    setLinkDialog({ show: true, title, urls });
  };

  const handleCopyLink = async (url: string) => {
    await Clipboard.write({ string: url });
    triggerHaptic();
    alert('Link Copied to Clipboard!');
  };

  const handleExportDocs = async () => {
    try {
      const fileName = `AI_Companion_Documentation_v${version}.txt`;
      await Filesystem.writeFile({
        path: fileName,
        data: DOCUMENTATION_CONTENT,
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
      });
      triggerHaptic('MEDIUM');
      alert(`Documentation exported to Documents/${fileName}`);
    } catch (error) {
      console.error('Export failed', error);
      alert('Export failed. Check permissions.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col border border-white/10 overflow-hidden">
        <header className="p-4 border-b border-surface flex justify-between items-center bg-surface/30">
          <h2 className="text-xl font-bold bg-gradient-to-r from-primary to-purple-400 bg-clip-text text-transparent">Settings</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-white transition-colors p-2 rounded-full hover:bg-white/5">
            <CloseIcon />
          </button>
        </header>

        <div className="flex flex-1 overflow-hidden flex-col md:flex-row">
          <SettingsSidebar activeTab={activeTab} setActiveTab={setActiveTab} />
          <SettingsMobileTabs activeTab={activeTab} setActiveTab={setActiveTab} />

          <main className="flex-1 overflow-y-auto p-0 bg-background/50 relative">
            {activeTab === 'setup' && (
              <div className="p-6">
                <SetupSettings
                  serverSettings={s.aimindmeshServerState}
                />
              </div>
            )}

            {activeTab === 'personality' && (
              <div className="p-6">
                <PersonalitySettings
                  personality={s.personalityState}
                  onPersonalitySave={s.setPersonalityState}
                  selectedPersonalityId={s.selectedPersonalityId}
                  onSelectedPersonalityIdChange={s.setSelectedPersonalityId}
                  customPersonalities={s.customPersonalitiesState}
                  onSaveCustomPersonality={(id, p) => s.setCustomPersonalitiesState((prev: Record<string, Personality>) => ({ ...prev, [id]: p }))}
                  onDeleteCustomPersonality={(id) => s.setCustomPersonalitiesState((prev: Record<string, Personality>) => {
                    const next = { ...prev };
                    delete next[id];
                    return next;
                  })}
                  proactiveFrequency={s.proactiveFreqState}
                  onProactiveFrequencyChange={s.setProactiveFreqState}
                />
              </div>
            )}

            {activeTab === 'llm' && (
              <div className="p-6">
                <LLMSettings
                  llmConfig={s.llmState}
                  onLlmConfigSave={s.setLlmState}
                  apiKey={s.apiKeyState}
                  onApiKeyChange={s.setApiKeyState}
                  perplexityApiKey={s.perplexityApiKeyState}
                  onPerplexityApiKeyChange={s.setPerplexityApiKeyState}
                  claudeApiKey={s.claudeApiKeyState}
                  onClaudeApiKeyChange={s.setClaudeApiKeyState}
                  openrouterApiKey={s.openrouterApiKeyState}
                  onOpenRouterApiKeyChange={s.setOpenrouterApiKeyState}
                  openRouterModels={s.openRouterModelsState}
                  isFetchingOpenRouterModels={s.isFetchingOpenRouterModels}
                  onRefreshOpenRouterModels={s.handleRefreshOpenRouterModels}
                  geminiModels={s.geminiModelsState}
                  isFetchingGeminiModels={s.isFetchingGeminiModels}
                  onRefreshGeminiModels={s.handleRefreshGeminiModels}
                  hfToken={s.hfTokenState || ''}
                  onHfTokenChange={s.setHfTokenState}
                  serverSettings={s.aimindmeshServerState}
                />
              </div>
            )}

            {activeTab === 'knowledge' && (
              <div className="p-6">
                <KnowledgeSettings
                  llmConfig={s.llmState}
                  onLlmConfigSave={s.setLlmState}
                  disablePing={s.disableKnowledgeDbPingState}
                  onDisablePingChange={s.setDisableKnowledgeDbPingState}
                />
              </div>
            )}

            {activeTab === 'vision' && (
              <div className="p-6">
                <VisionSettings
                  llmConfig={s.llmState}
                  onLlmConfigSave={s.setLlmState}
                  hfToken={s.hfTokenState || ''}
                />
              </div>
            )}

            {activeTab === 'stt' && (
              <div className="p-6">
                <STTSettings
                  speechConfig={s.speechConfigState}
                  onSpeechConfigChange={s.setSpeechConfigState}
                  externalVoskModels={s.externalVoskModelsState}
                  onExternalVoskModelsChange={s.setExternalVoskModelsState}
                  externalWhisperModels={s.externalWhisperModelsState}
                  onExternalWhisperModelsChange={s.setExternalWhisperModelsState}
                  externalVADModels={s.externalVADModelsState}
                  onExternalVADModelsChange={s.setExternalVADModelsState}
                  externalVoxtralModels={s.externalVoxtralModelsState}
                  onExternalVoxtralModelsChange={s.setExternalVoxtralModelsState}
                  apiKey={s.apiKeyState}
                />
              </div>
            )}

            {activeTab === 'wakeword' && (
              <div className="p-6">
                <WakeWordSettings
                  enabled={s.wakeWordState.enabled}
                  onEnabledChange={(v) => s.setWakeWordState((prev: any) => ({ ...prev, enabled: v }))}
                  modelName={s.wakeWordState.modelName}
                  onModelChange={(v) => s.setWakeWordState((prev: any) => ({ ...prev, modelName: v }))}
                  threshold={s.wakeWordState.threshold}
                  onThresholdChange={(v) => s.setWakeWordState((prev: any) => ({ ...prev, threshold: v }))}
                  cooldownMs={s.wakeWordState.cooldownMs}
                  onCooldownChange={(v) => s.setWakeWordState((prev: any) => ({ ...prev, cooldownMs: v }))}
                  bufferSize={s.wakeWordState.bufferSize}
                  onBufferSizeChange={(v) => s.setWakeWordState((prev: any) => ({ ...prev, bufferSize: v }))}
                  consecutiveFrames={s.wakeWordState.consecutiveFrames}
                  onConsecutiveFramesChange={(v) => s.setWakeWordState((prev: any) => ({ ...prev, consecutiveFrames: v }))}
                />
              </div>
            )}

            {activeTab === 'tts' && (
              <div className="p-6">
                <TTSSettings
                  speechConfig={s.speechConfigState}
                  onSpeechConfigChange={s.setSpeechConfigState}
                  onShowLink={handleShowLink}
                  externalPiperVoices={s.externalPiperVoicesState}
                  onExternalPiperVoicesChange={s.setExternalPiperVoicesState}
                  llmConfig={s.llmState}
                  apiKey={s.apiKeyState}
                />
              </div>
            )}

            {activeTab === 'speaker' && (
              <SpeakerSettings speechConfig={s.speechConfigState} onSpeechConfigChange={s.setSpeechConfigState} />
            )}

            {activeTab === 'memory' && (
              <MemorySettings
                memories={memories} onAddMemory={onAddMemory} onDeleteMemory={onDeleteMemory}
                onClearMemories={() => { if (window.confirm("Delete ALL memories?")) onClearMemories(); }}
                memoryCategories={memoryCategories} onAddMemoryCategory={onAddMemoryCategory}
                onDeleteMemoryCategory={onDeleteMemoryCategory} onUpdateMemoryCategory={onUpdateMemoryCategory}
                onExportMemories={onExportMemories} onImportMemories={onImportMemories}
                enableAiMemoryCategorization={s.enableAiMemoryCategorization}
                onEnableAiMemoryCategorizationChange={s.setEnableAiMemoryCategorization}
                llmConfig={s.llmState} onLlmConfigSave={s.setLlmState} apiKey={s.apiKeyState}
              />
            )}

            {activeTab === 'agenda' && (
              <AgendaSettings
                settings={s.agendaSettingsState}
                onSettingsChange={s.setAgendaSettingsState}
              />
            )}

            {activeTab === 'storage' && <FileStorageManager onClose={() => setActiveTab('app')} />}

            {activeTab === 'agentic' && (
              <AgenticSettings llmConfig={s.llmState} onLlmConfigSave={s.setLlmState} hfToken={s.hfTokenState || ''} />
            )}

            {activeTab === 'proactive' && (
              <div className="p-6">
                <ProactiveSettings settings={s.proactiveSettingsState} onSettingsChange={s.setProactiveSettingsState} />
              </div>
            )}

            {activeTab === 'aimindmesh-server' && (
              <div className="p-6">
                <AIMindMeshServerSettingsPanel
                  settings={s.aimindmeshServerState}
                  onChange={s.setAimindmeshServerState}
                  isSyncing={s.isSyncingState}
                  onSync={s.handleSync}
                />
                {/* Auto-sync toggle */}
                <div className="flex items-center justify-between mt-6 pt-5 border-t border-white/5">
                  <div>
                    <div className="text-sm font-medium text-text-primary">Auto-Sync New Memories</div>
                    <div className="text-xs text-text-secondary mt-0.5">Automatically push new memories to the server KG</div>
                  </div>
                  <button
                    id="settings-auto-sync-memories-toggle"
                    onClick={() => s.setAutoSyncNewMemoriesState(!s.autoSyncNewMemoriesState)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
                      s.autoSyncNewMemoriesState ? 'bg-primary' : 'bg-white/20'
                    }`}
                    aria-pressed={s.autoSyncNewMemoriesState}
                  >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                      s.autoSyncNewMemoriesState ? 'translate-x-4' : 'translate-x-0.5'
                    }`} />
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'app' && (
              <AppSettings
                autoPlayAudio={s.autoPlayAudioState} onAutoPlayAudioChange={s.setAutoPlayAudioState}
                enableDnd={s.enableDndState} onEnableDndChange={s.setEnableDndState}
                dndStart={s.dndStartState} onDndStartChange={s.setDndStartState}
                dndEnd={s.dndEndState} onDndEndChange={s.setDndEndState}
                responseStyle={s.responseStyleState} onResponseStyleChange={s.setResponseStyleState}
                onClearChatHistory={onClearChatHistory}
                enableSystemMonitor={s.enableSystemMonitorState} onEnableSystemMonitorChange={s.setEnableSystemMonitorState}
                systemMonitorFrequency={s.systemMonitorFrequencyState} onSystemMonitorFrequencyChange={s.setSystemMonitorFrequencyState}
                showRam={s.showRamState} onShowRamChange={s.setShowRamState}
                showAppRam={s.showAppRamState} onShowAppRamChange={s.setShowAppRamState}
                showCpu={s.showCpuState} onShowCpuChange={s.setShowCpuState}
                showGpu={s.showGpuState} onShowGpuChange={s.setShowGpuState}
                enableNotificationVibration={s.enableNotificationVibrationState}
                onEnableNotificationVibrationChange={s.setEnableNotificationVibrationState}
                saveMeetingAudio={s.saveMeetingAudioState}
                onSaveMeetingAudioChange={s.setSaveMeetingAudioState}
                aimindmeshServer={s.aimindmeshServerState}
                autoCheckUpdates={s.autoCheckUpdatesState}
                onAutoCheckUpdatesChange={s.setAutoCheckUpdatesState}
              />
            )}

            {activeTab === 'theme' && (
              <ThemeSettings
                themeConfig={s.themeState}
                onThemeConfigChange={(config) => { s.setThemeState(config); applyTheme(getThemeColors(config), config.presetId === 'system'); }}
              />
            )}

            {activeTab === 'log' && (
              <LogViewer
                logEntries={s.logEntries} isLoggingEnabled={s.isLoggingEnabled}
                onLoggingToggle={s.handleLoggingToggle} onClearLogs={s.handleClearLogs}
              />
            )}

            {activeTab === 'auto' && (
              <div className="p-6">
                <AndroidAutoSettings
                  settings={s.androidAutoState}
                  onSettingsChange={s.setAndroidAutoState}
                />
              </div>
            )}

            {activeTab === 'docs' && <SettingsDocumentation onExportDocs={handleExportDocs} />}
          </main>
        </div>

        <footer className="p-4 border-t border-surface bg-surface/30 flex justify-end gap-3 z-10">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-surface hover:bg-white/10 text-text-secondary transition-colors font-medium">Cancel</button>
          <button onClick={s.handleSave} className="px-6 py-2 rounded-lg bg-gradient-to-r from-primary to-purple-600 hover:opacity-90 text-white shadow-lg shadow-primary/20 transition-all font-medium transform active:scale-95">Save Changes</button>
        </footer>
        <div className="text-center pb-2 text-xs text-text-secondary/50">v{version}</div>
      </div>

      <LinkDialog
        show={linkDialog.show} title={linkDialog.title} urls={linkDialog.urls}
        onClose={() => setLinkDialog({ ...linkDialog, show: false })}
        onCopy={handleCopyLink}
      />
    </div>
  );
};

export default SettingsModal;