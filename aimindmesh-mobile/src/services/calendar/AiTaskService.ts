import { CalendarTask, AiTaskExecution } from '../../types/calendar';
import { logger } from '../logger';

/**
 * Retrieves the server base URL from saved settings, or uses the default
 */
export function getBaseUrl(): string {
    try {
        const raw = localStorage.getItem('aimindmesh-server-settings');
        if (raw) {
            const settings = JSON.parse(raw);
            if (settings.serverUrl) {
                // Remove trailing slash if present
                return settings.serverUrl.replace(/\/$/, '');
            }
        }
    } catch (e) {
        logger.log('warn', '[AiTaskService] Unable to parse server settings', e);
    }
    // Fallback default VPS IP if not found
    return 'http://10.2.0.1:3030';
}

/**
 * Helper to retrieve the API key from saved settings
 */
export function getApiKey(): string {
    try {
        const raw = localStorage.getItem('aimindmesh-server-settings');
        if (raw) {
            const settings = JSON.parse(raw);
            if (settings.apiKey) return settings.apiKey;
        }
    } catch (e) {
        // Fallback
    }
    return '';
}

/**
 * AiTaskService
 * Manages communication with the server's AI Task Scheduler.
 */
export const AiTaskService = {

    /**
     * Retrieves all AI tasks present on the server.
     */
    async getAllServerTasks(): Promise<any[]> {
        try {
            const response = await fetch(`${getBaseUrl()}/api/ai-tasks`, {
                headers: {
                    'x-api-key': getApiKey()
                }
            });
            if (!response.ok) {
                throw new Error(`Fetch tasks failed: ${response.statusText}`);
            }
            return await response.json();
        } catch (error) {
            logger.log('error', '[AiTaskService] Error retrieving server task list', error);
            throw error;
        }
    },

    /**
     * Synchronizes (Creates/Updates) an AI task on the server.
     * Called when a task is saved from TaskDetailModal.
     */
    async syncTask(task: CalendarTask): Promise<void> {
        if (!task.aiConfig) return;

        const payload = {
            id: task.id,
            title: task.title,
            promptTemplate: task.aiConfig.promptTemplate,
            model: task.aiConfig.model,
            outputFormat: task.aiConfig.outputFormat,
            storagePolicy: task.aiConfig.storagePolicy,
            requiresReview: task.aiConfig.requiresReview,
            cronExpression: task.aiConfig.cronExpression,
            scheduledAt: task.aiConfig.scheduledAt
        };

        try {
            // Try to determine if the task already exists on the server
            // In this "idempotent" architecture, we use POST but the server handles ON CONFLICT.
            // However, for consistency with the spec, we implement a fallback or use POST directly
            // since the server has now been updated to handle the input id.
            const response = await fetch(`${getBaseUrl()}/api/ai-tasks`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-api-key': getApiKey()
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `Sync failed: ${response.statusText}`);
            }

            logger.log('info', `[AiTaskService] Task ${task.id} synchronized on the server`);
        } catch (error) {
            logger.log('error', `[AiTaskService] Error synchronizing task ${task.id}`, error);
            throw error;
        }
    },

    /**
     * Requests immediate execution of the task on the server
     * (ignores cron scheduling).
     */
    async runNow(taskId: string): Promise<string> {
        try {
            const response = await fetch(`${getBaseUrl()}/api/ai-tasks/${taskId}/run`, {
                method: 'POST',
                headers: {
                    'x-api-key': getApiKey()
                }
            });

            if (!response.ok) {
                throw new Error(`RunTrigger failed: ${response.statusText}`);
            }

            // The server responds with 202 "Execution queued"
            const data = await response.json();
            logger.log('info', `[AiTaskService] Task ${taskId} successfully triggered.`);
            return data.taskId;
        } catch (error) {
            logger.log('error', `[AiTaskService] Error triggering runNow for task ${taskId}`, error);
            throw error;
        }
    },

    /**
     * Polls the status of the task's last execution.
     */
    async getLastExecution(taskId: string): Promise<AiTaskExecution | null> {
        try {
            const response = await fetch(`${getBaseUrl()}/api/ai-tasks/${taskId}`, {
                method: 'GET',
                headers: {
                    'x-api-key': getApiKey()
                }
            });

            if (response.status === 404) return null;
            
            if (!response.ok) {
                throw new Error(`GetTask failed: ${response.statusText}`);
            }

            const data = await response.json();
            return data.lastExecution || null;
        } catch (error) {
            logger.log('error', `[AiTaskService] Error retrieving status for task ${taskId}`, error);
            return null;
        }
    },

    /**
     * Downloads the most recent task output (artifact).
     * Uses the server shortcut /api/ai-tasks/:id/artifact
     */
    async getArtifact(taskId: string): Promise<string> {
        try {
            const response = await fetch(`${getBaseUrl()}/api/ai-tasks/${taskId}/artifact`, {
                method: 'GET',
                headers: {
                    'x-api-key': getApiKey()
                }
            });

            if (response.status === 404) return 'No artifact available.';

            if (!response.ok) {
                throw new Error(`GetArtifact failed: ${response.statusText}`);
            }

            return await response.text();
        } catch (error) {
            logger.log('error', `[AiTaskService] Error loading artifact for ${taskId}`, error);
            throw error;
        }
    }
};
