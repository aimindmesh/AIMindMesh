import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Keyboard } from '@capacitor/keyboard';
import { Settings } from './types';
import { useAppSettings } from './hooks/useAppSettings';
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
import { useAppInteractions, AppBackHandlers } from './hooks/useAppInteractions';
import { useAppServices } from './hooks/useAppServices';
import { setKnowledgeDbPingEnabled } from './services/database/knowledgeDatabase';
import { initMemoryMonitor } from './services/native/memoryMonitor';
import { unlockTtsAudioContextSync } from './services/tts/speech';
import { migrateLegacyKeepAlive, useKeepAlive } from './services/performance/keepAliveSetting';
import VoiceChatOverlay from './components/overlays/VoiceChatOverlay';
import IncomingCallOverlay from './components/overlays/IncomingCallOverlay';
import SystemMonitor from './components/overlays/SystemMonitor';
import ThreadListModal from './components/modals/ThreadListModal';
import Toast from './components/ui/Toast';
import MeetingMode from './components/meeting/MeetingMode';
import AgendaMode from './components/agenda/AgendaMode';
import TodoListView from './components/agenda/TodoListView';
import ToolConfirmationModal from './components/modals/ToolConfirmationModal';
import ImageGenModal from './components/modals/ImageGenModal';
import { ChatArea } from './components/chat/ChatArea';
import { useProactiveSuggestions } from './hooks/useProactiveSuggestions';
import { SuggestionCard } from './components/Proactive/SuggestionCard';
import SettingsModal from './components/settings/SettingsModal';
import { OnboardingWizard, shouldShowOnboarding } from './components/onboarding/OnboardingWizard';
// v4.0.0 Feed imports
import { InsightItem } from './services/feedService';
import { useServerMode } from './hooks/useServerMode';
import { useProactiveMessage } from './hooks/useProactiveMessage';
import { AppNavbar } from './components/layout/AppNavbar';
import { AppTabContent, AppTab } from './components/layout/AppTabContent';

const App: React.FC = () => {
  // --- Global Settings & State ---
  const cfg = useAppSettings();
  const { personality, llmConfig, setLlmConfig, speechConfig, apiKey, perplexityApiKey, claudeApiKey, aimindmeshServer, proactiveSettings } = cfg;

  // One keep-alive flag (Settings → App → Performance) for the native services and the background features
  migrateLegacyKeepAlive(llmConfig.keepAlive);
  const [keepAlive] = useKeepAlive();

  // v4.0.0 — Feed navigation state
  const [activeAppTab, setActiveAppTab] = useState<AppTab>('chat');
  const [feedUnreadCount, setFeedUnreadCount] = useState(0);
  const [openFeedInsight, setOpenFeedInsight] = useState<InsightItem | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(shouldShowOnboarding);

  // --- UI State & Interactions (Hook) ---
  // Back steps for what App renders itself, filled in after the chat hook below
  const backHandlersRef = useRef<AppBackHandlers | null>(null);
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
  } = useAppInteractions(backHandlersRef);

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
    autoSyncNewMemories: cfg.autoSyncNewMemories
  });

  // The memory categorization flag is kept by useAppMemories
  const modalSettings = useMemo(() => ({ ...cfg.modalSettings, enableAiMemoryCategorization }), [cfg.modalSettings, enableAiMemoryCategorization]);
  const { saveSettings } = cfg;
  const handleSaveSettings = useCallback((newSettings: Settings) => {
    saveSettings(newSettings);
    setEnableAiMemoryCategorization(newSettings.enableAiMemoryCategorization ?? true);
  }, [saveSettings, setEnableAiMemoryCategorization]);

  const { dbReady } = useAppDatabase(showToastProxy);

  useEffect(() => {
    // Initialize native memory monitor
    initMemoryMonitor();

    // Disable webview auto-scroll when keyboard opens
    Keyboard.setScroll({ isDisabled: true }).catch(err => logger.log('error', '[App] Failed to disable keyboard scroll', err));
  }, []); // Run once on mount

  // v4.0.0 — Server mode lifecycle (FCM + heartbeat + proactive fallback)
  useServerMode({ serverSettings: aimindmeshServer, proactiveSettings, llmConfig, personality });

  // --- Hooks ---
  const { todos, addTodo, completeTodo, deleteTodo } = useTodoList();
  const { isNativeLLMLoading } = useModelLoader(llmConfig);
  const { isAppActive } = useAppLifecycle(keepAlive, isVoiceMode);

  // --- Keyboard Shortcuts ---
  useKeyboardShortcuts(
    () => setIsSettingsOpen(prev => !prev),
    () => setIsThreadListOpen(prev => !prev)
  );

  useNotificationPermission();

  // --- Android Auto Sync ---
  useAndroidAutoSync(todos, cfg.androidAutoSettings, dbReady);

  // --- Sync Knowledge DB Ping ---
  useEffect(() => { setKnowledgeDbPingEnabled(!cfg.disableKnowledgeDbPing); }, [cfg.disableKnowledgeDbPing]);

  // --- Wake Word ---
  const { wakeWordConfig } = cfg;
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
    cfg.responseStyle,
    cfg.autoPlayAudio || isVoiceMode,
    chatContext,
    activeThreadIdState,
    (toolName, rule) => setLlmConfig(prev => ({
      ...prev,
      toolRules: { ...prev.toolRules, [toolName]: rule }
    })),
    aimindmeshServer
  );

  // Services (Extraction, Summarization, Proactive)
  useAppServices(chat, llmConfig, isAppActive, apiKey, perplexityApiKey, claudeApiKey, personality, addMemory, activeThreadIdState, showToast, keepAlive);

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

  const isAppIdle = !isSettingsOpen && !isVoiceMode && !incomingCall && !isProactiveThinking && (isAppActive || keepAlive);

  const handleEngagement = useCallback(() => {
    const isCall = Math.random() < 0.2;
    if (isCall && proactiveSettings.permissions.autonomousCalls) {
      setIncomingCall(personality);
    } else {
      handleProactiveMessage();
    }
  }, [handleProactiveMessage, personality, proactiveSettings]);

  useProactiveEngagement({
    frequency: cfg.proactiveFrequency,
    isIdle: isAppIdle,
    onEngage: handleEngagement,
    enableDnd: cfg.enableDnd,
    dndStart: cfg.dndStart,
    dndEnd: cfg.dndEnd,
    idleDetails: { isSettingsOpen, isVoiceMode, incomingCall: !!incomingCall, isProactiveThinking, isAppActive, keepAlive }
  });

  // --- Image Studio (Qualcomm NPU) State & Handlers ---
  const [isImageGenModalOpen, setIsImageGenModalOpen] = useState(false);
  const [imageGenSourceImage, setImageGenSourceImage] = useState<string | undefined>(undefined);
  const [imageGenPrompt, setImageGenPrompt] = useState<string | undefined>(undefined);

  // Back button: overlays and navigation App owns (read by the listener in useAppInteractions)
  backHandlersRef.current = {
    closeOverlay: () => {
      if (chat.pendingToolCall) { chat.handleConfirmTool(false, false); return true; }
      if (isImageGenModalOpen) { setIsImageGenModalOpen(false); return true; }
      return false;
    },
    navigateBack: () => {
      if (activeAppTab === 'feed' && openFeedInsight) { setOpenFeedInsight(null); return true; }
      if (activeAppTab !== 'chat') { setActiveAppTab('chat'); return true; }
      return false;
    }
  };

  const handleOpenImageStudio = useCallback(() => {
    const attached = chat.pendingImages[0];
    if (attached) {
      const src = attached.base64 ? `data:${attached.mimeType};base64,${attached.base64}` : attached.webPath;
      setImageGenSourceImage(src);
    } else {
      setImageGenSourceImage(undefined);
    }
    setImageGenPrompt(chat.input || undefined);
    setIsImageGenModalOpen(true);
  }, [chat.pendingImages, chat.input]);

  const handleEditImageFromChat = useCallback((imgSrc: string) => {
    setImageGenSourceImage(imgSrc);
    setImageGenPrompt(''); // SD needs a description of the result, not an instruction
    setIsImageGenModalOpen(true);
  }, []);

  const handleInsertGeneratedImage = useCallback((base64Image: string, prompt: string) => {
    chat.addPendingImage({
      name: `generated_${Date.now()}.png`,
      base64: base64Image.replace(/^data:image\/\w+;base64,/, ''),
      mimeType: 'image/png'
    });
    if (!chat.input.trim()) {
      chat.setInput(`Generated with Qualcomm NPU: "${prompt}"`);
    }
    showToast('Image attached to chat! 🎨', 'success');
  }, [chat, showToast]);

  // --- Render ---
  return (
    <div className="fixed inset-0 bg-background overflow-hidden flex flex-col pt-safe">
      {/* Tab content area */}
      <div className="flex-1 overflow-hidden relative">
        <AppTabContent
          activeTab={activeAppTab}
          serverSettings={aimindmeshServer}
          agentProvider={llmConfig.serverSideAgentProvider || 'openclaw'}
          openFeedInsight={openFeedInsight}
          onOpenFeedInsight={setOpenFeedInsight}
          onFeedUnreadCountChange={setFeedUnreadCount}
          chat={
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
              onOpenImageStudio={handleOpenImageStudio}
              onEditImage={handleEditImageFromChat}
              onOpenThreads={() => setIsThreadListOpen(true)}
              onNewChat={handleNewConversation}
              onOpenTodo={() => setIsTodoListOpen(true)}
              onOpenAgenda={() => setIsAgendaOpen(true)}
              onOpenMeeting={() => setIsMeetingMode(true)}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onClearChat={handleClearChat}
            />
          }
        />
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
        settings={modalSettings}
        onSave={handleSaveSettings}
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
        customPersonalities={cfg.customPersonalities}
        onSaveCustomPersonality={cfg.saveCustomPersonality}
        onDeleteCustomPersonality={cfg.deleteCustomPersonality}
        agendaSettings={cfg.agendaSettings}
        onAgendaSettingsChange={cfg.setAgendaSettings}
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
          onSaveTranscript={(role, text) => chat.setMessages(prev => [...prev, { id: `${Date.now()}_${role}`, role, text, timestamp: new Date() }])}
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

      {cfg.enableSystemMonitor && (
        <SystemMonitor
          frequency={cfg.systemMonitorFrequency}
          showRam={cfg.showRam}
          showAppRam={cfg.showAppRam}
          showCpu={cfg.showCpu}
          showGpu={cfg.showGpu}
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
          defaultView={initialView as any || cfg.agendaSettings.defaultView}
          showSystemCalendar={cfg.agendaSettings.showSystemCalendar}
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

      <ImageGenModal
        isOpen={isImageGenModalOpen}
        onClose={() => setIsImageGenModalOpen(false)}
        initialImage={imageGenSourceImage}
        initialPrompt={imageGenPrompt}
        onInsertIntoChat={handleInsertGeneratedImage}
      />

      {/* First launch: guided setup above everything */}
      {showOnboarding && <OnboardingWizard onComplete={() => setShowOnboarding(false)} />}
    </div>
  );
};

export default App;
