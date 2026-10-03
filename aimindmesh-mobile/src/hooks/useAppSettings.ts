import { useMemo, useCallback, useEffect } from 'react';
import { Personality, LLMConfig, SpeechConfig, ProactiveFrequency, ResponseStyle, WakeWordSettings, DEFAULT_WAKE_WORD_SETTINGS, ThemeConfig, DEFAULT_THEME_CONFIG, ProactiveSettings, Settings, AIMindMeshServerSettings, DEFAULT_AIMINDMESH_SERVER_SETTINGS } from '../types';
import { useLocalStorage } from './useLocalStorage';
import { PRESET_PERSONALITIES } from '../constants';
import { DEFAULT_PROACTIVE_SETTINGS } from '../types/proactive';
import { AgendaSettings, DEFAULT_AGENDA_SETTINGS } from '../services/calendar/calendarService';
import { applyTheme, getThemeColors } from '../components/settings/system/ThemeSettings';
import { logger } from '../services/logger';
import { normalizeSttProvider, normalizeTtsProvider } from '../services/tts/providerIds';

const DEFAULT_LLM_CONFIG: LLMConfig = {
  provider: 'gemini',
  localEndpoint: 'http://localhost:11434/v1',
  localModel: 'llama3',
  selectedGGUF: 'Phi-3-mini-4k-instruct-q4f32_1-MLC',
  enableThinking: true,
  enableToolCalling: true,
  nCtx: 2048,
  useMmap: true,
};

const DEFAULT_ANDROID_AUTO = {
  enabled: true,
  showCallMode: true,
  showCalendar: true,
  showToDo: true,
  showKanban: true
};

/**
 * App-wide persisted settings, the object the settings screen edits and how a save is applied.
 * The memory categorization flag lives in useAppMemories: App adds it to both.
 */
export function useAppSettings() {
  const [customPersonalities, setCustomPersonalities] = useLocalStorage<Record<string, Personality>>('custom-personalities', {});
  const [personality, setPersonality] = useLocalStorage<Personality>('companion-personality', PRESET_PERSONALITIES.aria);
  const [llmConfig, setLlmConfig] = useLocalStorage<LLMConfig>('llm-config', DEFAULT_LLM_CONFIG);
  const [speechConfigRaw, setSpeechConfig] = useLocalStorage<SpeechConfig>('speech-config', { ttsProvider: 'offline', sttProvider: 'offline' });

  // Normalize legacy/capitalized provider IDs ('gemini' -> 'online', 'Vosk' -> 'vosk', …) so every consumer matches
  const speechConfig = useMemo(() => ({
    ...speechConfigRaw,
    ttsProvider: normalizeTtsProvider(speechConfigRaw.ttsProvider),
    sttProvider: normalizeSttProvider(speechConfigRaw.sttProvider),
  }), [speechConfigRaw]);
  const [apiKey, setApiKey] = useLocalStorage<string>('gemini-api-key', '');
  const [perplexityApiKey, setPerplexityApiKey] = useLocalStorage<string>('perplexity-api-key', '');
  const [claudeApiKey, setClaudeApiKey] = useLocalStorage<string>('claude-api-key', '');
  const [hfToken, setHfToken] = useLocalStorage<string>('hf-token', '');

  const [autoPlayAudio, setAutoPlayAudio] = useLocalStorage('app-settings-autoplay', false);
  const [proactiveFrequency, setProactiveFrequency] = useLocalStorage<ProactiveFrequency>('proactive-frequency', 'off');
  const [responseStyle, setResponseStyle] = useLocalStorage<ResponseStyle>('response-style', 'normal');
  const [enableDnd, setEnableDnd] = useLocalStorage<boolean>('enable-dnd', false);
  const [dndStart, setDndStart] = useLocalStorage<string>('dnd-start', '22:00');
  const [dndEnd, setDndEnd] = useLocalStorage<string>('dnd-end', '08:00');
  const [wakeWordConfig, setWakeWordConfig] = useLocalStorage<WakeWordSettings>('wake-word-config', DEFAULT_WAKE_WORD_SETTINGS);
  const [agendaSettings, setAgendaSettings] = useLocalStorage<AgendaSettings>('agenda-settings', DEFAULT_AGENDA_SETTINGS);
  const [themeConfig, setThemeConfig] = useLocalStorage<ThemeConfig>('theme-config', DEFAULT_THEME_CONFIG);
  const [enableSystemMonitor, setEnableSystemMonitor] = useLocalStorage<boolean>('enable-system-monitor', false);
  const [systemMonitorFrequency, setSystemMonitorFrequency] = useLocalStorage<number>('system-monitor-frequency', 1000);
  const [showRam, setShowRam] = useLocalStorage<boolean>('system-monitor-show-ram', true);
  const [showAppRam, setShowAppRam] = useLocalStorage<boolean>('system-monitor-show-app-ram', true);
  const [showCpu, setShowCpu] = useLocalStorage<boolean>('system-monitor-show-cpu', true);
  const [showGpu, setShowGpu] = useLocalStorage<boolean>('system-monitor-show-gpu', true);
  const [androidAutoSettings, setAndroidAutoSettings] = useLocalStorage<any>('android-auto-settings', DEFAULT_ANDROID_AUTO);
  const [disableKnowledgeDbPing, setDisableKnowledgeDbPing] = useLocalStorage<boolean>('disable-knowledge-db-ping', true);
  const [proactiveSettings, setProactiveSettings] = useLocalStorage<ProactiveSettings>('proactive-settings', DEFAULT_PROACTIVE_SETTINGS);
  const [enableNotificationVibration, setEnableNotificationVibration] = useLocalStorage<boolean>('enable-notification-vibration', true);
  const [saveMeetingAudio, setSaveMeetingAudio] = useLocalStorage<boolean>('save-meeting-audio', true);
  const [autoCheckUpdates, setAutoCheckUpdates] = useLocalStorage<boolean>('auto-check-updates', true);

  // v4.0.0 — AIMindMesh Server
  const [aimindmeshServer, setAimindmeshServer] = useLocalStorage<AIMindMeshServerSettings>('aimindmesh-server-settings', DEFAULT_AIMINDMESH_SERVER_SETTINGS);
  const [autoSyncNewMemories, setAutoSyncNewMemories] = useLocalStorage<boolean>('auto-sync-new-memories', false);

  // --- Config Migration (Ensure defaults for new features) ---
  useEffect(() => {
    // Check if critical new flags are undefined and default them to true
    if (llmConfig.enableThinking === undefined || llmConfig.enableToolCalling === undefined) {
      logger.log('info', '[App] Migrating LLM config with new defaults');
      setLlmConfig(prev => ({
        ...prev,
        enableThinking: prev.enableThinking ?? true,
        enableToolCalling: prev.enableToolCalling ?? true
      }));
    }
  }, []); // Run once on mount

  // --- Apply Theme ---
  useEffect(() => { applyTheme(getThemeColors(themeConfig), themeConfig.presetId === 'system'); }, [themeConfig]);

  // The object the settings screen copies when it opens
  const modalSettings: Settings = useMemo(() => ({
    personality, llmConfig, speechConfig, apiKey, perplexityApiKey, claudeApiKey, hfToken,
    autoPlayAudio, enableDnd, dndStart, dndEnd, responseStyle, proactiveFrequency,
    wakeWord: wakeWordConfig,
    theme: themeConfig,
    enableSystemMonitor,
    systemMonitorFrequency,
    showRam,
    showAppRam,
    showCpu,
    showGpu,
    androidAuto: androidAutoSettings,
    disableKnowledgeDbPing,
    proactive: proactiveSettings,
    enableNotificationVibration,
    saveMeetingAudio,
    aimindmeshServer,
    autoSyncNewMemories,
    autoCheckUpdates
  }), [personality, llmConfig, speechConfig, apiKey, perplexityApiKey, claudeApiKey, hfToken, autoPlayAudio, enableDnd, dndStart, dndEnd,
    responseStyle, proactiveFrequency, wakeWordConfig, themeConfig, enableSystemMonitor, systemMonitorFrequency,
    showRam, showAppRam, showCpu, showGpu, androidAutoSettings, disableKnowledgeDbPing, proactiveSettings, enableNotificationVibration,
    saveMeetingAudio, aimindmeshServer, autoSyncNewMemories, autoCheckUpdates]);

  const saveSettings = useCallback((newSettings: Settings) => {
    setPersonality(newSettings.personality);
    setLlmConfig(newSettings.llmConfig);
    setSpeechConfig(newSettings.speechConfig);
    setApiKey(newSettings.apiKey);
    setPerplexityApiKey(newSettings.perplexityApiKey || '');
    setClaudeApiKey(newSettings.claudeApiKey || '');
    setHfToken(newSettings.hfToken || '');
    setAutoPlayAudio(newSettings.autoPlayAudio);
    setEnableDnd(newSettings.enableDnd);
    setDndStart(newSettings.dndStart);
    setDndEnd(newSettings.dndEnd);
    setResponseStyle(newSettings.responseStyle);
    setProactiveFrequency(newSettings.proactiveFrequency);
    setEnableSystemMonitor(newSettings.enableSystemMonitor ?? false);
    setSystemMonitorFrequency(newSettings.systemMonitorFrequency ?? 1000);
    setShowRam(newSettings.showRam ?? true);
    setShowAppRam(newSettings.showAppRam ?? true);
    setShowCpu(newSettings.showCpu ?? true);
    setShowGpu(newSettings.showGpu ?? true);
    setDisableKnowledgeDbPing(newSettings.disableKnowledgeDbPing ?? true);
    if (newSettings.wakeWord) setWakeWordConfig(newSettings.wakeWord);
    if (newSettings.theme) setThemeConfig(newSettings.theme); // applied by the theme effect
    if (newSettings.androidAuto) setAndroidAutoSettings(newSettings.androidAuto);
    if (newSettings.proactive) setProactiveSettings(newSettings.proactive);
    if (newSettings.enableNotificationVibration !== undefined) setEnableNotificationVibration(newSettings.enableNotificationVibration);
    if (newSettings.saveMeetingAudio !== undefined) setSaveMeetingAudio(newSettings.saveMeetingAudio);
    if (newSettings.aimindmeshServer) setAimindmeshServer(newSettings.aimindmeshServer);
    if (newSettings.autoSyncNewMemories !== undefined) setAutoSyncNewMemories(newSettings.autoSyncNewMemories);
    if (newSettings.autoCheckUpdates !== undefined) setAutoCheckUpdates(newSettings.autoCheckUpdates);
    // The setters of useLocalStorage are stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveCustomPersonality = useCallback((id: string, p: Personality) =>
    setCustomPersonalities(prev => ({ ...prev, [id]: p })), [setCustomPersonalities]);
  const deleteCustomPersonality = useCallback((id: string) => setCustomPersonalities(prev => {
    const next = { ...prev };
    delete next[id];
    return next;
  }), [setCustomPersonalities]);

  return {
    personality, llmConfig, setLlmConfig, speechConfig, apiKey, perplexityApiKey, claudeApiKey,
    autoPlayAudio, proactiveFrequency, responseStyle, enableDnd, dndStart, dndEnd,
    wakeWordConfig, agendaSettings, setAgendaSettings, themeConfig,
    enableSystemMonitor, systemMonitorFrequency, showRam, showAppRam, showCpu, showGpu,
    androidAutoSettings, disableKnowledgeDbPing, proactiveSettings,
    aimindmeshServer, autoSyncNewMemories,
    customPersonalities, saveCustomPersonality, deleteCustomPersonality,
    modalSettings, saveSettings
  };
}
