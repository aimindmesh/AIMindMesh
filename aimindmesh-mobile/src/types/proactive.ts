
export enum ProactiveActionType {
    // Silent actions (no user interruption)
    SILENT_PRELOAD_MODEL = 'silent_preload_model',
    SILENT_SYNC_DATA = 'silent_sync_data',
    SILENT_CACHE_CLEANUP = 'silent_cache_cleanup',
    SILENT_INDEX_DOCUMENTS = 'silent_index_documents',

    // Informative actions (passive notification)
    INFO_BADGE_UPDATE = 'info_badge_update',
    INFO_TOAST = 'info_toast',
    INFO_SYSTEM_NOTIFICATION = 'info_system_notification',

    // Suggestive actions (in-app suggestions)
    SUGGEST_TASK_PRIORITY = 'suggest_task_priority',
    SUGGEST_SCHEDULE_CHANGE = 'suggest_schedule_change',
    SUGGEST_BREAK = 'suggest_break',
    SUGGEST_KNOWLEDGE_REVIEW = 'suggest_knowledge_review',
    SUGGEST_OPTIMIZATION = 'suggest_optimization',
    SUGGEST_TASK_REVIEW = 'suggest_task_review',

    // Interactive actions (chat messages)
    CHAT_MORNING_BRIEFING = 'chat_morning_briefing',
    CHAT_EVENT_REMINDER = 'chat_event_reminder',
    CHAT_MEETING_BRIEFING = 'chat_meeting_briefing',
    CHAT_EOD_SUMMARY = 'chat_eod_summary',
    CHAT_FOLLOWUP_QUESTION = 'chat_followup_question',
    CHAT_CURIOSITY = 'chat_curiosity',

    // Autonomous actions (direct modifications)
    AUTO_CREATE_TASK = 'auto_create_task',
    AUTO_RESCHEDULE_EVENT = 'auto_reschedule_event',
    AUTO_CATEGORIZE_NOTE = 'auto_categorize_note',
    AUTO_TAG_MEMORY = 'auto_tag_memory',
    AUTO_ARCHIVE_OLD_DATA = 'auto_archive_old_data',
    PERFORM_MEMORY_MAINTENANCE = 'perform_memory_maintenance',
    SUMMARIZE_CONTEXT = 'summarize_context',
}

export interface ProactiveAction {
    id: string;
    type: ProactiveActionType;
    category: 'silent' | 'informative' | 'suggestive' | 'interactive' | 'autonomous';

    // Metadata
    triggeredBy: string; // trigger ID
    triggeredAt: number; // timestamp
    expiresAt?: number; // timestamp when action is no longer relevant

    // Action data
    data: any;

    // Execution
    status: 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled' | 'ignored';
    result?: any;
    error?: string;

    // User interaction
    requiresConfirmation: boolean;
    confirmed?: boolean;
    dismissible: boolean;

    // Priority for conflict resolution
    priority: number; // 0-10, 10 is highest

    // Logging
    logLevel: 'debug' | 'info' | 'warning' | 'critical';
}

export interface ProactiveSettings {
    enabled: boolean;
    source: 'auto' | 'local';
    aggressiveness: 'minimal' | 'balanced' | 'proactive' | 'very_proactive';
    quietHours: {
        enabled: boolean;
        start: number;
        end: number;
        allowCritical: boolean;
    };
    permissions: {
        silent: boolean;
        informative: boolean;
        suggestive: boolean;
        interactive: boolean;
        autonomous: boolean;
        autonomousCalls: boolean;
    };
    actionControls: {
        [key in ProactiveActionType]?: {
            enabled: boolean;
            frequency: 'rare' | 'occasional' | 'normal' | 'frequent';
            requireConfirmation: boolean;
        };
    };
    contextAwareness: {
        respectFocusMode: boolean;
        respectBatteryLevel: boolean;
        respectDataUsage: boolean;
        adaptToUserPattern: boolean;
        enableAutoSummarization: boolean;
        summarizationThreshold: number;
        meetingBriefingLeadTimeMinutes: number;
    };
    notifications: {
        sound: boolean;
        vibration: boolean;
        led: boolean;
        priority: 'min' | 'low' | 'default' | 'high';
        grouping: boolean;
    };
    learning: {
        enabled: boolean;
        trackDismissals: boolean;
        trackInteractions: boolean;
        adaptFrequency: boolean;
    };
    limits: {
        maxActionsPerHour: number;
        maxAutonomousPerDay: number;
        maxChatMessagesPerDay: number;
    };
}

export const DEFAULT_PROACTIVE_SETTINGS: ProactiveSettings = {
    enabled: true,
    source: 'auto',
    aggressiveness: 'balanced',
    quietHours: {
        enabled: true,
        start: 22,
        end: 7,
        allowCritical: true,
    },
    permissions: {
        silent: true,
        informative: true,
        suggestive: true,
        interactive: true,
        autonomous: false,
        autonomousCalls: false,
    },
    actionControls: {
        [ProactiveActionType.CHAT_MORNING_BRIEFING]: {
            enabled: true,
            frequency: 'normal',
            requireConfirmation: false,
        },
        [ProactiveActionType.AUTO_RESCHEDULE_EVENT]: {
            enabled: false,
            frequency: 'rare',
            requireConfirmation: true,
        },
    },
    contextAwareness: {
        respectFocusMode: true,
        respectBatteryLevel: true,
        respectDataUsage: true,
        adaptToUserPattern: true,
        enableAutoSummarization: true,
        summarizationThreshold: 0.5,
        meetingBriefingLeadTimeMinutes: 5,
    },
    notifications: {
        sound: true,
        vibration: true,
        led: false,
        priority: 'default',
        grouping: true,
    },
    learning: {
        enabled: true,
        trackDismissals: true,
        trackInteractions: true,
        adaptFrequency: true,
    },
    limits: {
        maxActionsPerHour: 4,
        maxAutonomousPerDay: 10,
        maxChatMessagesPerDay: 15,
    },
};
