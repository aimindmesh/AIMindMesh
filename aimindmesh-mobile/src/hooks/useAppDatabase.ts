import { useState, useEffect } from 'react';
import { logger } from '../services/logger';
import { DatabaseManager } from '../services/database/DatabaseManager';
import { initKnowledgeDatabase } from '../services/database/knowledgeDatabase';
import { initCalendarDatabase } from '../services/calendar/calendarDatabase';
import { initMemoryDatabase } from '../services/memory/memoryDatabase';

export const useAppDatabase = (showToast: (message: string, type?: 'success' | 'error' | 'info') => void) => {
    const [dbReady, setDbReady] = useState(false);

    useEffect(() => {
        const initDatabases = async () => {
            try {
                logger.log('info', '[App] Initializing databases...');
                // Initialize centralized manager first (opens all connections sequentially)
                await DatabaseManager.getInstance().initializeAll();

                // Initialize schemas (these will reuse the open connections)
                await initKnowledgeDatabase();
                await initCalendarDatabase();
                await initMemoryDatabase();

                logger.log('info', '[App] All databases initialized');
                setDbReady(true);
            } catch (error) {
                logger.log('error', '[App] Failed to initialize databases', error);
                showToast('Database initialization failed', 'error');
            }
        };

        initDatabases();
    }, [showToast]);

    return { dbReady };
};
