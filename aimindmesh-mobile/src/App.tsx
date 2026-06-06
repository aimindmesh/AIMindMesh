import React, { useState, useEffect, useCallback } from 'react';
import { Keyboard } from '@capacitor/keyboard';
import { Personality, LLMConfig, SpeechConfig, ProactiveFrequency, ResponseStyle, WakeWordSettings, DEFAULT_WAKE_WORD_SETTINGS, ThemeConfig, DEFAULT_THEME_CONFIG, ProactiveSettings, Settings, AIMindMeshServerSettings, DEFAULT_AIMINDMESH_SERVER_SETTINGS } from './types';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useAppLifecycle } from './hooks/useAppLifecycle';
import { useModelLoader } from './hooks/useModelLoader';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useChat } from './hooks/useChat';
import { useTodoList } from './hooks/useTodoList';
import { useProactiveEngagement } from './hooks/useProactiveEngagement';
import { useNotificationPermission } from './hooks/useNotificationPermission';
import { logger } from './services/logger';
import { triggerHaptic } from './services/native';
import { useWakeWord } from './hooks/useWakeWord';
import { useAndroidAutoSync } from './hooks/useAndroidAutoSync';
import { useThreadManager } from './hooks/useThreadManager';
import { useAppDatabase } from './hooks/useAppDatabase';
import { useAppMemories } from './hooks/useAppMemories';
import { useAppInteractions } from './hooks/useAppInteractions';
import { useAppServices } from './hooks/useAppServices';
import { setKnowledgeDbPingEnabled } from './services/database/knowledgeDatabase';
import { applyTheme, getThemeColors } from './components/settings/system/ThemeSettings';
import { initMemoryMonitor } from './services/native/memoryMonitor';
import { unlockTtsAudioContextSync } from './services/tts/speech';
import VoiceChatOverlay from './components/overlays/VoiceChatOverlay';
import IncomingCallOverlay from './components/overlays/IncomingCallOverlay';
import SystemMonitor from './components/overlays/SystemMonitor';
import ThreadListModal from './components/modals/ThreadListModal';
import Toast from './components/ui/Toast';
import MeetingMode from './components/meeting/MeetingMode';
import AgendaMode from './components/agenda/AgendaMode';
import TodoListView from './components/agenda/TodoListView';
import ToolConfirmationModal from './components/modals/ToolConfirmationModal';
import { ChatArea } from './components/chat/ChatArea';
import { PRESET_PERSONALITIES } from './constants';
import { useProactiveSuggestions } from './hooks/useProactiveSuggestions';
import { SuggestionCard } from './components/Proactive/SuggestionCard';
import { DEFAULT_PROACTIVE_SETTINGS } from './types/proactive';
import { AgendaSettings, DEFAULT_AGENDA_SETTINGS } from './services/calendar/calendarService';
import SettingsModal from './components/settings/SettingsModal';
// v4.0.0 Feed imports
import FeedView from './views/FeedView';
import FeedThreadView from './views/FeedThreadView';
import { InsightItem } from './services/feedService';
import { useServerMode } from './hooks/useServerMode';
import { useProactiveMessage } from './hooks/useProactiveMessage';
import { AppNavbar } from './components/layout/AppNavbar';
import ServerAgentView from './views/ServerAgentView';
import LibraryView from './views/LibraryView';
import WikiView from './views/WikiView';
import OrganizationView from './views/OrganizationView';

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

const App: React.FC = () => {
  // --- Global Settings & State ---
  const [customPersonalities, setCustomPersonalities] = useLocalStorage<Record<string, Personality>>('custom-personalities', {});
  const [personality, setPersonality] = useLocalStorage<Personality>('companion-personality', PRESET_PERSONALITIES.aria);
  const [llmConfig, setLlmConfig] = useLocalStorage<LLMConfig>('llm-config', DEFAULT_LLM_CONFIG);
  const [speechConfigRaw, setSpeechConfig] = useLocalStorage<SpeechConfig>('speech-config', { ttsProvider: 'offline', sttProvider: 'offline' });
  
  // Normalize legacy provider IDs ('gemini' -> 'online', 'system' -> 'offline') to ensure UI panels render correctly
  const speechConfig = React.useMemo(() => {
    let tts = speechConfigRaw.ttsProvider;
    let stt = speechConfigRaw.sttProvider;
    if ((tts as unknown as string) === 'gemini') tts = 'online';
    if ((tts as unknown as string) === 'system') tts = 'offline';
    if ((stt as unknown as string) === 'gemini') stt = 'online';
    if ((stt as unknown as string) === 'system') stt = 'offline';
    return { ...speechConfigRaw, ttsProvider: tts, sttProvider: stt };
  }, [speechConfigRaw]);
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
  const [androidAutoSettings, setAndroidAutoSettings] = useLocalStorage<any>('android-auto-settings', {
    enabled: true,
    showCallMode: true,
    showCalendar: true,
    showToDo: true,
    showKanban: true
  });
  const [disableKnowledgeDbPing, setDisableKnowledgeDbPing] = useLocalStorage<boolean>('disable-knowledge-db-ping', true);
  const [proactiveSettings, setProactiveSettings] = useLocalStorage<ProactiveSettings>('proactive-settings', DEFAULT_PROACTIVE_SETTINGS);
  const [enableNotificationVibration, setEnableNotificationVibration] = useLocalStorage<boolean>('enable-notification-vibration', true);
  const [saveMeetingAudio, setSaveMeetingAudio] = useLocalStorage<boolean>('save-meeting-audio', true);

  // v4.0.0 — AIMindMesh Server
  const [aimindmeshServer, setAimindmeshServer] = useLocalStorage<AIMindMeshServerSettings>('aimindmesh-server-settings', DEFAULT_AIMINDMESH_SERVER_SETTINGS);
  const [autoSyncNewMemories, setAutoSyncNewMemories] = useLocalStorage<boolean>('auto-sync-new-memories', false);

  // v4.0.0 — Feed navigation state
  type AppTab = 'chat' | 'feed' | 'server-agent' | 'library' | 'wiki' | 'organization';
  const [activeAppTab, setActiveAppTab] = useState<AppTab>('chat');
  const [feedUnreadCount, setFeedUnreadCount] = useState(0);
  const [openFeedInsight, setOpenFeedInsight] = useState<InsightItem | null>(null);

  // --- UI State & Interactions (Hook) ---
  const {
    isSettingsOpen, setIsSettingsOpen,
    isVoiceMode, setIsVoiceMode,
    isProactiveThinking, setIsProactiveThinking,
    incomingCall, setIncomingCall,
    isThreadListOpen, setIsThreadListOpen,
    isMeetingMode, setIsMeetingMode,
    isAgendaOpen, setIsAgendaOpen,
    isTodoListOpen, setIsTodoListOpen,
    initialView,
    toast, showToast: showToastProxy, hideToast,
    justAcceptedCall, setJustAcceptedCall
  } = useAppInteractions({
    pendingToolCall: null,
    handleConfirmTool: (c: boolean, r: boolean) => (window as any).chat?.handleConfirmTool(c, r)
  });

  // --- Utils ---
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
    showToastProxy(message, type);
  }, [showToastProxy]);

  const showToastInternal = useCallback((m: string, t?: any) => showToastProxy?.(m, t), [showToastProxy]);

  // --- Custom Hooks ---
  const {
    memories,
    addMemory, deleteMemory, clearMemories,
    addMemoryCategory, deleteMemoryCategory, updateMemoryCategory,
    exportMemories, importMemories,
    memoryCategories,
    enableAiMemoryCategorization, setEnableAiMemoryCategorization
  } = useAppMemories({
    showToast: showToastInternal,
    serverSettings: aimindmeshServer,
    autoSyncNewMemories
  });

  const { dbReady } = useAppDatabase(showToastProxy);

  // --- Config Migration (Ensure defaults for new features) ---
  useEffect(() => {
    // Initialize native memory monitor
    initMemoryMonitor();
    
    // Disable webview auto-scroll when keyboard opens
    Keyboard.setScroll({ isDisabled: true }).catch(err => logger.log('error', '[App] Failed to disable keyboard scroll', err));
    
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

  // v4.0.0 — Server mode lifecycle (FCM + heartbeat + proactive fallback)
  useServerMode({ serverSettings: aimindmeshServer, proactiveSettings, llmConfig, personality });

  // --- Hooks ---
  const { todos, addTodo, completeTodo, deleteTodo } = useTodoList();
  const { isNativeLLMLoading } = useModelLoader(llmConfig, speechConfig);
  const { isAppActive } = useAppLifecycle(!!llmConfig.keepAlive);

  // Sync KeepAlive on mount for persistence
  useEffect(() => {
    if (llmConfig.keepAlive) {
      import('./services/performancePlugin').then(p => p.default.startKeepAlive()).catch(e => logger.log('error', 'Failed to start KeepAlive on mount', e));
    }
  }, []);

  // --- Keyboard Shortcuts ---
  useKeyboardShortcuts(
    () => setIsSettingsOpen(prev => !prev),
    () => setIsThreadListOpen(prev => !prev)
  );

  useNotificationPermission();

  // --- Android Auto Sync ---
  useAndroidAutoSync(todos, androidAutoSettings, dbReady);

  // --- Apply Theme ---
  useEffect(() => { applyTheme(getThemeColors(themeConfig), themeConfig.presetId === 'system'); }, [themeConfig]);
  // --- Sync Knowledge DB Ping ---
  useEffect(() => { setKnowledgeDbPingEnabled(!disableKnowledgeDbPing); }, [disableKnowledgeDbPing]);


  // --- Wake Word ---
  useWakeWord({
    enabled: wakeWordConfig.enabled && !isNativeLLMLoading,
    modelName: wakeWordConfig.modelName,
    threshold: wakeWordConfig.threshold,
    cooldownMs: wakeWordConfig.cooldownMs,
    bufferSize: wakeWordConfig.bufferSize,
    onWakeWordDetected: (detection) => {
      logger.log('info', `[App] Wake word detected: ${detection.wakeWord}`);
      setIsVoiceMode(true);
    }
  });

  // --- Chat Hook ---
  const {
    activeThreadIdState,
    syncMessages,
    handleNewConversation: onNewConversation,
    handleSelectThread: onSelectThread,
    handleClearChat: onClearChat
  } = useThreadManager(showToastProxy, setIsThreadListOpen);

  const chatContext = {
    todos,
    addTodo,
    completeTodo,
    memories,
    addMemory,
    showToast
  };

  const chat = useChat(
    llmConfig,
    personality,
    speechConfig,
    { gemini: apiKey, perplexity: perplexityApiKey, claude: claudeApiKey },
    responseStyle,
    autoPlayAudio || isVoiceMode,
    chatContext,
    activeThreadIdState,
    (toolName, rule) => setLlmConfig(prev => ({
      ...prev,
      toolRules: { ...prev.toolRules, [toolName]: rule }
    })),
    aimindmeshServer
  );

  // Expose chat to window for useAppInteractions back button handler proxy
  useEffect(() => {
    (window as any).chat = chat;
  }, [chat]);

  // Services (Extraction, Summarization, Proactive)
  useAppServices(chat, llmConfig, isAppActive, apiKey, perplexityApiKey, claudeApiKey, personality, addMemory, activeThreadIdState, showToast);

  const { suggestions, acceptSuggestion, dismissSuggestion } = useProactiveSuggestions();

  useEffect(() => {
    syncMessages(chat.messages);
  }, [chat.messages, syncMessages]);

  const handleNewConversation = useCallback(() => onNewConversation(chat.setMessages), [onNewConversation, chat.setMessages]);
  const handleSelectThread = useCallback((id: string) => onSelectThread(id, chat.setMessages), [onSelectThread, chat.setMessages]);
  const handleClearChat = useCallback(() => onClearChat(chat.setMessages), [onClearChat, chat.setMessages]);

  const { handleProactiveMessage } = useProactiveMessage({
    chat,
    personality,
    llmConfig,
    apiKey,
    isProactiveThinking,
    setIsProactiveThinking,
    incomingCall: !!incomingCall,
    isSettingsOpen,
    isVoiceMode,
    isAppActive,
    activeThreadId: activeThreadIdState,
    proactiveSettings,
  });

  const isAppIdle = !isSettingsOpen && !isVoiceMode && !incomingCall && !isProactiveThinking && (isAppActive || !!llmConfig.keepAlive);

  const handleEngagement = useCallback(() => {
    const isCall = Math.random() < 0.2;
    if (isCall && proactiveSettings.permissions.autonomousCalls) {
      setIncomingCall(personality);
    } else {
      handleProactiveMessage();
    }
  }, [handleProactiveMessage, personality, proactiveSettings]);

  useProactiveEngagement({
    frequency: proactiveFrequency,
    isIdle: isAppIdle,
    onEngage: handleEngagement,
    enableDnd,
    dndStart,
    dndEnd,
    idleDetails: { isSettingsOpen, isVoiceMode, incomingCall: !!incomingCall, isProactiveThinking, isAppActive, keepAlive: !!llmConfig.keepAlive }
  });

  // Extraction and summarization are handled by useAppServices


  // --- Render ---
  return (
    <div className="fixed inset-0 bg-background overflow-hidden flex flex-col pt-safe">
      {/* Tab content area */}
      <div className="flex-1 overflow-hidden relative">
        {/* Chat Tab */}
        {activeAppTab === 'chat' && (
          <div className="h-full">
            <ChatArea
              messages={chat.messages}
              personality={personality}
              isLoading={chat.isLoading}
              isNativeLLMLoading={isNativeLLMLoading}
              input={chat.input}
              setInput={chat.setInput}
              isInputDisabled={isVoiceMode || incomingCall !== null || !!chat.pendingToolCall}
              onSendMessage={(e) => { e?.preventDefault(); chat.sendMessage(chat.input); }}
              onStopGeneration={chat.stopGeneration}
              onAttachImage={chat.handleAttachImage}
              onAttachAudio={chat.handleAttachAudio}
              onAttachFile={chat.handleAttachFile}
              onVoiceMode={() => { unlockTtsAudioContextSync(); setIsVoiceMode(true); }}
              pendingImages={chat.pendingImages}
              pendingAudio={chat.pendingAudio}
              pendingFiles={chat.pendingFiles}
              onRemoveImage={chat.removeImage}
              onRemoveAudio={chat.removeAudio}
              onRemoveFile={chat.removeFile}
              onResend={chat.handleResend}
              onRegenerate={chat.handleRegenerate}
              onOpenThreads={() => setIsThreadListOpen(true)}
              onNewChat={handleNewConversation}
              onOpenTodo={() => setIsTodoListOpen(true)}
              onOpenAgenda={() => setIsAgendaOpen(true)}
              onOpenMeeting={() => setIsMeetingMode(true)}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onClearChat={handleClearChat}
            />
          </div>
        )}

        {/* Feed Tab */}
        {activeAppTab === 'feed' && (
          <div className="h-full">
            {openFeedInsight && aimindmeshServer ? (
              <FeedThreadView
                insight={openFeedInsight}
                serverSettings={aimindmeshServer}
                onClose={() => setOpenFeedInsight(null)}
              />
            ) : (
              <FeedView
                serverSettings={aimindmeshServer?.enabled ? aimindmeshServer : undefined}
                onOpenThread={(insight) => setOpenFeedInsight(insight)}
                onUnreadCountChange={setFeedUnreadCount}
              />
            )}
          </div>
        )}

        {/* Server Agent Tab */}
        {activeAppTab === 'server-agent' && aimindmeshServer && (
          <div className="h-full">
            <ServerAgentView
              settings={aimindmeshServer}
              provider={llmConfig.serverSideAgentProvider || 'openclaw'}
            />
          </div>
        )}

        {/* Library Tab */}
        {activeAppTab === 'library' && (
          <div className="h-full">
            <LibraryView serverSettings={aimindmeshServer?.enabled ? aimindmeshServer : undefined} />
          </div>
        )}

        {/* Wiki Tab */}
        {activeAppTab === 'wiki' && (
          <div className="h-full">
            <WikiView serverSettings={aimindmeshServer?.enabled ? aimindmeshServer : undefined} />
          </div>
        )}

        {/* Organization Tab */}
        {activeAppTab === 'organization' && (
          <div className="h-full">
            <OrganizationView serverSettings={aimindmeshServer?.enabled ? aimindmeshServer : undefined} />
          </div>
        )}
      </div>

      {/* Bottom Navigation Bar */}
      <AppNavbar
        activeTab={activeAppTab}
        onTabChange={(tab) => {
          setActiveAppTab(tab);
          if (tab === 'feed') setOpenFeedInsight(null);
        }}
        feedUnreadCount={feedUnreadCount}
      />


      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={{
          personality, llmConfig, speechConfig, apiKey, perplexityApiKey, claudeApiKey, hfToken,
          autoPlayAudio, enableDnd, dndStart, dndEnd, responseStyle, proactiveFrequency, enableAiMemoryCategorization,
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
          autoSyncNewMemories
        }}
        onSave={(newSettings: Settings) => {
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
          setEnableAiMemoryCategorization(newSettings.enableAiMemoryCategorization ?? true);
          setEnableSystemMonitor(newSettings.enableSystemMonitor ?? false);
          setSystemMonitorFrequency(newSettings.systemMonitorFrequency ?? 1000);
          setShowRam(newSettings.showRam ?? true);
          setShowAppRam(newSettings.showAppRam ?? true);
          setShowCpu(newSettings.showCpu ?? true);
          setShowGpu(newSettings.showGpu ?? true);
          setDisableKnowledgeDbPing(newSettings.disableKnowledgeDbPing ?? true);
          if (newSettings.wakeWord) {
            setWakeWordConfig(newSettings.wakeWord);
          }
          if (newSettings.theme) {
            setThemeConfig(newSettings.theme);
            applyTheme(getThemeColors(newSettings.theme), newSettings.theme.presetId === 'system');
          }
          if (newSettings.androidAuto) {
            setAndroidAutoSettings(newSettings.androidAuto);
          }
          if (newSettings.proactive) {
            setProactiveSettings(newSettings.proactive);
          }
          if (newSettings.enableNotificationVibration !== undefined) {
            setEnableNotificationVibration(newSettings.enableNotificationVibration);
          }
          if (newSettings.saveMeetingAudio !== undefined) {
            setSaveMeetingAudio(newSettings.saveMeetingAudio);
          }
          if (newSettings.aimindmeshServer) {
            setAimindmeshServer(newSettings.aimindmeshServer);
          }
          if (newSettings.autoSyncNewMemories !== undefined) {
            setAutoSyncNewMemories(newSettings.autoSyncNewMemories);
          }
        }}
        memories={memories}
        onAddMemory={addMemory}
        onDeleteMemory={deleteMemory}
        onClearMemories={clearMemories}
        onClearChatHistory={handleClearChat}
        memoryCategories={memoryCategories}
        onAddMemoryCategory={addMemoryCategory}
        onDeleteMemoryCategory={deleteMemoryCategory}
        onUpdateMemoryCategory={updateMemoryCategory}
        onExportMemories={exportMemories}
        onImportMemories={importMemories}
        customPersonalities={customPersonalities}
        onSaveCustomPersonality={(id: string, p: Personality) => setCustomPersonalities(prev => ({ ...prev, [id]: p }))}
        onDeleteCustomPersonality={(id: string) => setCustomPersonalities(prev => {
          const newCustom = { ...prev };
          delete newCustom[id];
          return newCustom;
        })}
        agendaSettings={agendaSettings}
        onAgendaSettingsChange={setAgendaSettings}
      />

      {isVoiceMode && (
        <VoiceChatOverlay
          personality={personality}
          apiKey={apiKey}
          onClose={() => {
            setIsVoiceMode(false);
            setJustAcceptedCall(false);
          }}
          sendMessage={chat.sendMessage}
          isSpeaking={chat.isSpeaking}
          isLoading={chat.isLoading}
          currentThinking={chat.messages[chat.messages.length - 1]?.thinking}
          speechConfig={speechConfig}
          autoStartConversation={justAcceptedCall}
        />
      )}

      {incomingCall && (
        <IncomingCallOverlay
          personality={incomingCall}
          onAccept={() => {
            unlockTtsAudioContextSync();
            setIncomingCall(null);
            setJustAcceptedCall(true);
            setIsVoiceMode(true);
          }}
          onDecline={() => setIncomingCall(null)}
        />
      )}

      {enableSystemMonitor && (
        <SystemMonitor
          frequency={systemMonitorFrequency}
          showRam={showRam}
          showAppRam={showAppRam}
          showCpu={showCpu}
          showGpu={showGpu}
        />
      )}

      {isMeetingMode && (
        <MeetingMode
          onClose={() => setIsMeetingMode(false)}
          personality={personality}
          llmConfig={llmConfig}
          apiKey={apiKey}
          memories={memories}
          speechConfig={speechConfig}
        />
      )}

      {isAgendaOpen && (
        <AgendaMode
          onClose={() => setIsAgendaOpen(false)}
          defaultView={initialView as any || agendaSettings.defaultView}
          showSystemCalendar={agendaSettings.showSystemCalendar}
          llmConfig={llmConfig}
          apiKey={apiKey}
          personality={personality}
          serverSettings={aimindmeshServer?.enabled ? aimindmeshServer : undefined}
        />
      )}

      {isThreadListOpen && (
        <ThreadListModal
          isOpen={isThreadListOpen}
          onClose={() => setIsThreadListOpen(false)}
          onSelectThread={handleSelectThread}
          activeThreadId={activeThreadIdState}
          onNewConversation={handleNewConversation}
        />
      )}

      {isTodoListOpen && (
        <TodoListView
          isOpen={isTodoListOpen}
          onClose={() => setIsTodoListOpen(false)}
          todos={todos}
          onCompleteTodo={(id) => {
            completeTodo(id);
            showToast('Task completed! 🎉', 'success');
            triggerHaptic('MEDIUM');
          }}
          onAddTodo={(text) => {
            addTodo(text);
            showToast('Task added! ✓', 'success');
            triggerHaptic();
          }}
          onDeleteTodo={(id) => {
            deleteTodo(id);
            showToast('Task deleted', 'info');
            triggerHaptic('MEDIUM');
          }}
        />
      )}

      <Toast
        message={toast.message}
        isVisible={toast.isVisible}
        onClose={hideToast}
        type={toast.type}
      />

      {/* Proactive Suggestions Overlay */}
      <div className="absolute bottom-24 right-4 z-40 flex flex-col gap-2 w-full max-w-sm pointer-events-none items-end">
        {suggestions.map(action => (
          <div key={action.id} className="pointer-events-auto w-full">
            <SuggestionCard
              action={action}
              onAccept={acceptSuggestion}
              onDismiss={(action) => dismissSuggestion(action.id)}
            />
          </div>
        ))}
      </div>
      {chat.pendingToolCall && (
        <ToolConfirmationModal
          call={chat.pendingToolCall}
          onConfirm={(remember) => chat.handleConfirmTool(true, remember)}
          onCancel={() => chat.handleConfirmTool(false, false)}
        />
      )}

    </div>
  );
};

export default App;