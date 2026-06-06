import { useState, useEffect } from 'react';
import { Settings, Personality, LLMConfig, SpeechConfig, ProactiveFrequency, ResponseStyle, ThemeConfig, DEFAULT_THEME_CONFIG, DEFAULT_PROACTIVE_SETTINGS, ProactiveSettings as ProactiveSettingsType, AIMindMeshServerSettings, DEFAULT_AIMINDMESH_SERVER_SETTINGS } from '../types';
import { AgendaSettings as AgendaSettingsType } from '../services/calendar/calendarService';
import { PRESET_PERSONALITIES } from '../constants';
import { triggerHaptic } from '../services/native';
import { logger, LogEntry } from '../services/logger';
import { fetchOpenRouterModels, OpenRouterModel } from '../services/llm/providers/openrouterProvider';
import { fetchGeminiModels } from '../services/llm/providers/geminiProvider';
import { GlobalSyncService } from '../services/GlobalSyncService';

export const useSettingsState = (
    isOpen: boolean,
    settings: Settings,
    onSave: (newSettings: Settings) => void,
    onClose: () => void,
    customPersonalities: Record<string, Personality>,
    onCustomPersonalitiesSave: (personalities: Record<string, Personality>) => void,
    agendaSettings: AgendaSettingsType,
    onAgendaSave: (newAgendaSettings: AgendaSettingsType) => void,
    onExternalPiperVoicesSave: (voices: string[]) => void
) => {
    // Local state for all settings categories
    const [personalityState, setPersonalityState] = useState<Personality>(settings.personality);
    const [selectedPersonalityId, setSelectedPersonalityId] = useState<string>(() => {
        const presetId = Object.keys(PRESET_PERSONALITIES).find(key => PRESET_PERSONALITIES[key].name === settings.personality.name);
        if (presetId) return presetId;
        const customId = Object.keys(customPersonalities).find(id => customPersonalities[id].name === settings.personality.name);
        if (customId) return customId;
        return 'aria';
    });

    const [llmState, setLlmState] = useState<LLMConfig>(settings.llmConfig);
    const [speechConfigState, setSpeechConfigState] = useState<SpeechConfig>(settings.speechConfig);

    // App Settings State
    const [autoPlayAudioState, setAutoPlayAudioState] = useState(settings.autoPlayAudio);
    const [enableDndState, setEnableDndState] = useState(settings.enableDnd);
    const [dndStartState, setDndStartState] = useState(settings.dndStart);
    const [dndEndState, setDndEndState] = useState(settings.dndEnd);
    const [responseStyleState, setResponseStyleState] = useState<ResponseStyle>(settings.responseStyle);
    const [proactiveFreqState, setProactiveFreqState] = useState<ProactiveFrequency>(settings.proactiveFrequency);
    const [enableAiMemoryCategorization, setEnableAiMemoryCategorization] = useState(settings.enableAiMemoryCategorization ?? true);
    const [enableSystemMonitorState, setEnableSystemMonitorState] = useState(settings.enableSystemMonitor ?? false);
    const [systemMonitorFrequencyState, setSystemMonitorFrequencyState] = useState(settings.systemMonitorFrequency ?? 1000);
    const [showRamState, setShowRamState] = useState(settings.showRam ?? true);
    const [showAppRamState, setShowAppRamState] = useState(settings.showAppRam ?? true);
    const [showCpuState, setShowCpuState] = useState(settings.showCpu ?? true);
    const [showGpuState, setShowGpuState] = useState(settings.showGpu ?? true);
    const [disableKnowledgeDbPingState, setDisableKnowledgeDbPingState] = useState(settings.disableKnowledgeDbPing ?? true);
    const [proactiveSettingsState, setProactiveSettingsState] = useState<ProactiveSettingsType>(settings.proactive || DEFAULT_PROACTIVE_SETTINGS);
    const [androidAutoState, setAndroidAutoState] = useState(settings.androidAuto || {
        enabled: true,
        showCallMode: true,
        showCalendar: true,
        showToDo: true,
        showKanban: true
    });
    const [agendaSettingsState, setAgendaSettingsState] = useState<AgendaSettingsType>(agendaSettings);
    const [enableNotificationVibrationState, setEnableNotificationVibrationState] = useState(settings.enableNotificationVibration ?? true);
    const [saveMeetingAudioState, setSaveMeetingAudioState] = useState(settings.saveMeetingAudio ?? true);
    const [customPersonalitiesState, setCustomPersonalitiesState] = useState<Record<string, Personality>>(customPersonalities);

    // v4.0.0 — AIMindMesh Server
    const [aimindmeshServerState, setAimindmeshServerState] = useState<AIMindMeshServerSettings>(
        settings.aimindmeshServer || DEFAULT_AIMINDMESH_SERVER_SETTINGS
    );
    const [autoSyncNewMemoriesState, setAutoSyncNewMemoriesState] = useState(settings.autoSyncNewMemories ?? false);
    const [autoCheckUpdatesState, setAutoCheckUpdatesState] = useState(settings.autoCheckUpdates ?? true);

    const [externalPiperVoicesState, setExternalPiperVoicesState] = useState<string[]>(() => {
        try {
            const saved = localStorage.getItem('external_piper_voices');
            return saved ? JSON.parse(saved) : [];
        } catch (e) { return []; }
    });

    // STT External Models
    const [externalVoskModelsState, setExternalVoskModelsState] = useState<string[]>(() => {
        try {
            const saved = localStorage.getItem('external_vosk_models');
            return saved ? JSON.parse(saved) : [];
        } catch (e) { return []; }
    });
    const [externalWhisperModelsState, setExternalWhisperModelsState] = useState<string[]>(() => {
        try {
            const saved = localStorage.getItem('external_whisper_models');
            return saved ? JSON.parse(saved) : [];
        } catch (e) { return []; }
    });
    const [externalVADModelsState, setExternalVADModelsState] = useState<string[]>(() => {
        try {
            const saved = localStorage.getItem('external_vad_models');
            return saved ? JSON.parse(saved) : [];
        } catch (e) { return []; }
    });
    const [externalVoxtralModelsState, setExternalVoxtralModelsState] = useState<string[]>(() => {
        try {
            const saved = localStorage.getItem('external_voxtral_models');
            return saved ? JSON.parse(saved) : [];
        } catch (e) { return []; }
    });

    // API Keys
    const [apiKeyState, setApiKeyState] = useState(settings.apiKey);
    const [perplexityApiKeyState, setPerplexityApiKeyState] = useState(settings.perplexityApiKey);
    const [claudeApiKeyState, setClaudeApiKeyState] = useState(settings.claudeApiKey);
    const [openrouterApiKeyState, setOpenrouterApiKeyState] = useState(settings.openrouterApiKey ?? '');
    const [openRouterModelsState, setOpenRouterModelsState] = useState<OpenRouterModel[]>(settings.openRouterModels || []);
    const [isFetchingOpenRouterModels, setIsFetchingOpenRouterModels] = useState(false);
    const [hfTokenState, setHfTokenState] = useState(settings.hfToken);

    // Gemini Models
    const [geminiModelsState, setGeminiModelsState] = useState<string[]>([]);
    const [isFetchingGeminiModels, setIsFetchingGeminiModels] = useState(false);

    // Wake Word State
    const [wakeWordState, setWakeWordState] = useState(settings.wakeWord || {
        enabled: false,
        modelName: 'hey_jarvis_v0.1.tflite',
        threshold: 0.5,
        cooldownMs: 2000,
        bufferSize: 20,
        consecutiveFrames: 8
    });

    // Theme State
    const [themeState, setThemeState] = useState<ThemeConfig>(settings.theme ?? DEFAULT_THEME_CONFIG);

    // Logging state
    const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
    const [isLoggingEnabled, setIsLoggingEnabled] = useState(logger.getIsEnabled());
    const [isSyncingState, setIsSyncingState] = useState(false);

    // Update local state when modal opens or settings change
    useEffect(() => {
        if (isOpen) {
            setPersonalityState(settings.personality);
            setLlmState(settings.llmConfig);
            setSpeechConfigState(settings.speechConfig);
            setApiKeyState(settings.apiKey);
            setPerplexityApiKeyState(settings.perplexityApiKey);
            setClaudeApiKeyState(settings.claudeApiKey);
            setOpenrouterApiKeyState(settings.openrouterApiKey ?? '');
            setOpenRouterModelsState(settings.openRouterModels || []);
            setHfTokenState(settings.hfToken);
            setAutoPlayAudioState(settings.autoPlayAudio);
            setEnableDndState(settings.enableDnd);
            setDndStartState(settings.dndStart);
            setDndEndState(settings.dndEnd);
            setResponseStyleState(settings.responseStyle);
            setProactiveFreqState(settings.proactiveFrequency);
            setEnableAiMemoryCategorization(settings.enableAiMemoryCategorization ?? true);
            setEnableSystemMonitorState(settings.enableSystemMonitor ?? false);
            setSystemMonitorFrequencyState(settings.systemMonitorFrequency ?? 1000);
            setShowRamState(settings.showRam ?? true);
            setShowAppRamState(settings.showAppRam ?? true);
            setShowCpuState(settings.showCpu ?? true);
            setShowGpuState(settings.showGpu ?? true);
            setDisableKnowledgeDbPingState(settings.disableKnowledgeDbPing ?? true);
            setProactiveSettingsState(settings.proactive || DEFAULT_PROACTIVE_SETTINGS);
            // supportServer removed in v4.0.0
            setAndroidAutoState(settings.androidAuto || {
                enabled: true,
                showCallMode: true,
                showCalendar: true,
                showToDo: true,
                showKanban: true
            });
            setAgendaSettingsState(agendaSettings);
            setEnableNotificationVibrationState(settings.enableNotificationVibration ?? true);
            setSaveMeetingAudioState(settings.saveMeetingAudio ?? true);
            setCustomPersonalitiesState(customPersonalities);
            setAimindmeshServerState(settings.aimindmeshServer || DEFAULT_AIMINDMESH_SERVER_SETTINGS);
            setAutoSyncNewMemoriesState(settings.autoSyncNewMemories ?? false);
            setAutoCheckUpdatesState(settings.autoCheckUpdates ?? true);
            try {
                const saved = localStorage.getItem('external_piper_voices');
                setExternalPiperVoicesState(saved ? JSON.parse(saved) : []);

                const savedVosk = localStorage.getItem('external_vosk_models');
                setExternalVoskModelsState(savedVosk ? JSON.parse(savedVosk) : []);

                const savedWhisper = localStorage.getItem('external_whisper_models');
                setExternalWhisperModelsState(savedWhisper ? JSON.parse(savedWhisper) : []);

                const savedVAD = localStorage.getItem('external_vad_models');
                setExternalVADModelsState(savedVAD ? JSON.parse(savedVAD) : []);

                const savedVoxtral = localStorage.getItem('external_voxtral_models');
                setExternalVoxtralModelsState(savedVoxtral ? JSON.parse(savedVoxtral) : []);
            } catch (e) {
                setExternalPiperVoicesState([]);
                setExternalVoskModelsState([]);
                setExternalWhisperModelsState([]);
                setExternalVADModelsState([]);
                setExternalVoxtralModelsState([]);
            }

            if (settings.wakeWord) {
                setWakeWordState(settings.wakeWord);
            }

            setThemeState(settings.theme ?? DEFAULT_THEME_CONFIG);
            setLogEntries(logger.getLogs());
            setIsLoggingEnabled(logger.getIsEnabled());

            // Auto-fetch OpenRouter models if list is empty
            if (!settings.openRouterModels || settings.openRouterModels.length === 0) {
                fetchORModels();
            }
            // Auto-fetch Gemini models if API key is present
            if (settings.apiKey) {
                fetchGModels(settings.apiKey);
            }
        }
    }, [isOpen, settings, agendaSettings]);

    const fetchORModels = async () => {
        setIsFetchingOpenRouterModels(true);
        try {
            const models = await fetchOpenRouterModels();
            setOpenRouterModelsState(models);
            triggerHaptic('LIGHT');
        } catch (error) {
            console.error('Failed to fetch OpenRouter models:', error);
        } finally {
            setIsFetchingOpenRouterModels(false);
        }
    };

    const fetchGModels = async (keyToUse?: string) => {
        const key = keyToUse || apiKeyState;
        if (!key) return;
        setIsFetchingGeminiModels(true);
        try {
            const models = await fetchGeminiModels(key);
            setGeminiModelsState(models);
            triggerHaptic('LIGHT');
        } catch (error) {
            logger.log('error', '[useSettingsState] Failed to fetch Gemini models', error);
        } finally {
            setIsFetchingGeminiModels(false);
        }
    };

    const handleSave = () => {
        triggerHaptic('MEDIUM');
        const newSettings: Settings = {
            ...settings,
            personality: personalityState,
            llmConfig: llmState,
            speechConfig: speechConfigState,
            apiKey: apiKeyState,
            perplexityApiKey: perplexityApiKeyState,
            claudeApiKey: claudeApiKeyState,
            openrouterApiKey: openrouterApiKeyState,
            openRouterModels: openRouterModelsState,
            hfToken: hfTokenState,
            autoPlayAudio: autoPlayAudioState,
            enableDnd: enableDndState,
            dndStart: dndStartState,
            dndEnd: dndEndState,
            responseStyle: responseStyleState,
            proactiveFrequency: proactiveFreqState,
            enableAiMemoryCategorization: enableAiMemoryCategorization,
            wakeWord: wakeWordState,
            theme: themeState,
            enableSystemMonitor: enableSystemMonitorState,
            systemMonitorFrequency: systemMonitorFrequencyState,
            showRam: showRamState,
            showAppRam: showAppRamState,
            showCpu: showCpuState,
            showGpu: showGpuState,
            disableKnowledgeDbPing: disableKnowledgeDbPingState,
            proactive: proactiveSettingsState,
            // supportServer removed in v4.0.0
            enableNotificationVibration: enableNotificationVibrationState,
            saveMeetingAudio: saveMeetingAudioState,
            androidAuto: androidAutoState,
            aimindmeshServer: aimindmeshServerState,
            autoSyncNewMemories: autoSyncNewMemoriesState,
            autoCheckUpdates: autoCheckUpdatesState,
        };

        onSave(newSettings);
        onAgendaSave(agendaSettingsState);
        onCustomPersonalitiesSave(customPersonalitiesState);
        onExternalPiperVoicesSave(externalPiperVoicesState);

        // Save STT External Models
        localStorage.setItem('external_vosk_models', JSON.stringify(externalVoskModelsState));
        localStorage.setItem('external_whisper_models', JSON.stringify(externalWhisperModelsState));
        localStorage.setItem('external_vad_models', JSON.stringify(externalVADModelsState));
        localStorage.setItem('external_voxtral_models', JSON.stringify(externalVoxtralModelsState));

        onClose();
    };

    const toggleDeliveryMode = () => {
        const newMode = aimindmeshServerState.deliveryMode === 'PUSH' ? 'CONTEXTUAL' : 'PUSH';
        setAimindmeshServerState(prev => ({ ...prev, deliveryMode: newMode }));
        triggerHaptic('LIGHT');
    };

    const handleLoggingToggle = () => {
        if (isLoggingEnabled) {
            logger.disable();
        } else {
            logger.enable();
        }
        setIsLoggingEnabled(logger.getIsEnabled());
    };

    const handleClearLogs = () => {
        logger.clear();
        setLogEntries([]);
    };

    const handleSync = async () => {
        setIsSyncingState(true);
        try {
            await GlobalSyncService.performSync(aimindmeshServerState);
        } finally {
            setIsSyncingState(false);
        }
    };

    return {
        personalityState, setPersonalityState,
        selectedPersonalityId, setSelectedPersonalityId,
        llmState, setLlmState,
        speechConfigState, setSpeechConfigState,
        autoPlayAudioState, setAutoPlayAudioState,
        enableDndState, setEnableDndState,
        dndStartState, setDndStartState,
        dndEndState, setDndEndState,
        responseStyleState, setResponseStyleState,
        proactiveFreqState, setProactiveFreqState,
        enableAiMemoryCategorization, setEnableAiMemoryCategorization,
        enableSystemMonitorState, setEnableSystemMonitorState,
        systemMonitorFrequencyState, setSystemMonitorFrequencyState,
        showRamState, setShowRamState,
        showAppRamState, setShowAppRamState,
        showCpuState, setShowCpuState,
        showGpuState, setShowGpuState,
        disableKnowledgeDbPingState, setDisableKnowledgeDbPingState,
        proactiveSettingsState, setProactiveSettingsState,
        // supportServerState removed
        enableNotificationVibrationState, setEnableNotificationVibrationState,
        saveMeetingAudioState, setSaveMeetingAudioState,
        androidAutoState, setAndroidAutoState,
        agendaSettingsState, setAgendaSettingsState,
        apiKeyState, setApiKeyState,
        perplexityApiKeyState, setPerplexityApiKeyState,
        claudeApiKeyState, setClaudeApiKeyState,
        openrouterApiKeyState, setOpenrouterApiKeyState,
        openRouterModelsState, setOpenRouterModelsState,
        isFetchingOpenRouterModels,
        handleRefreshOpenRouterModels: fetchORModels,
        hfTokenState, setHfTokenState,
        geminiModelsState, setGeminiModelsState,
        isFetchingGeminiModels,
        handleRefreshGeminiModels: fetchGModels,
        wakeWordState, setWakeWordState,
        themeState, setThemeState,
        customPersonalitiesState, setCustomPersonalitiesState,
        externalPiperVoicesState, setExternalPiperVoicesState,
        externalVoskModelsState, setExternalVoskModelsState,
        externalWhisperModelsState, setExternalWhisperModelsState,
        externalVADModelsState, setExternalVADModelsState,
        externalVoxtralModelsState, setExternalVoxtralModelsState,
        logEntries, setLogEntries,
        isLoggingEnabled, setIsLoggingEnabled,
        aimindmeshServerState, setAimindmeshServerState,
        autoSyncNewMemoriesState, setAutoSyncNewMemoriesState,
        autoCheckUpdatesState, setAutoCheckUpdatesState,
        toggleDeliveryMode,
        handleSave,
        handleLoggingToggle,
        handleClearLogs,
        isSyncingState,
        handleSync
    };
};
