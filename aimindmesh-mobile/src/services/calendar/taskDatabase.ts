/**
 * Task Database Service
 * SQLite-backed storage for Task Management (Kanban) functionality
 * Extension of the Calendar/Agenda module
 */

// Re-export Schema & Migration
export * from './tasks/taskSchema';

// Re-export Helpers
export * from './tasks/taskHelpers';

// Re-export Core Operations
export * from './tasks/taskOperations';

// Re-export Queries & Search
export * from './tasks/taskQueries';

// Re-export Synchronization
export * from './tasks/taskSync';
