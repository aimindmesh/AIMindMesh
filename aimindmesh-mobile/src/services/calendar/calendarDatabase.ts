/**
 * Calendar Database Service
 * SQLite-backed storage for Agenda events and notes
 * Refactored to use modular sub-modules
 */

// Re-export Types
export * from './agenda/agendaTypes';

// Re-export Schema & Initialization
export * from './agenda/agendaSchema';

// Re-export Event CRUD
export * from './agenda/eventOperations';

// Re-export Note CRUD
export * from './agenda/noteOperations';

// Re-export Search
export * from './agenda/agendaSearch';

// Re-export Export/Import
export * from './agenda/agendaTransfer';

// Re-export Stats & Maintenance
export * from './agenda/agendaStats';
