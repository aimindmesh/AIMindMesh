import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import { App } from '@capacitor/app';
import { logger } from '../logger';

// Database Types
export type DatabaseType = 'knowledge' | 'calendar' | 'memory' | 'meeting';

interface DatabaseConfig {
    name: string;
    version: number;
    encrypted: boolean;
    mode: string;
}

const DB_CONFIGS: Record<DatabaseType, DatabaseConfig> = {
    knowledge: {
        name: 'knowledge_db',
        version: 1,
        encrypted: false,
        mode: 'no-encryption'
    },
    calendar: {
        name: 'calendar_db',
        version: 1,
        encrypted: false,
        mode: 'no-encryption'
    },
    memory: {
        name: 'memories_db',
        version: 2,
        encrypted: false,
        mode: 'no-encryption'
    },
    meeting: {
        name: 'meetings_db',
        version: 1,
        encrypted: false,
        mode: 'no-encryption'
    }
};

export class DatabaseManager {
    private static instance: DatabaseManager;
    private sqliteConnection: SQLiteConnection | null = null;
    private connections: Map<DatabaseType, SQLiteDBConnection> = new Map();
    private initPromises: Map<DatabaseType, Promise<SQLiteDBConnection>> = new Map();
    private isInitialized = false;

    // Write serialization queue — WAL handles concurrent reads, writes need serialization
    private writeQueue: Array<() => Promise<void>> = [];
    private isWriting = false;

    private constructor() { }

    public static getInstance(): DatabaseManager {
        if (!DatabaseManager.instance) {
            DatabaseManager.instance = new DatabaseManager();
        }
        return DatabaseManager.instance;
    }

    /**
     * Initialize the master SQLite connection wrapper
     */
    private initSQLiteConnection(): void {
        if (!this.sqliteConnection) {
            // console.log('[DatabaseManager] Creating SQLiteConnection wrapper');
            this.sqliteConnection = new SQLiteConnection(CapacitorSQLite);
        }
    }

    /**
     * Initialize all defined databases sequentially
     */
    public async initializeAll(): Promise<void> {
        if (this.isInitialized) {
            logger.log('info', '[DatabaseManager] Already initialized, skipping');
            return;
        }

        try {
            this.initSQLiteConnection();

            // Check consistency (optional but good practice)
            if (this.sqliteConnection) {
                // await this.sqliteConnection.checkConnectionsConsistency(); 
                // Note: checkConnectionsConsistency might interfere if we are not careful, 
                // but usually good ensuring state.
            }

            logger.log('info', '[DatabaseManager] Initializing all databases...');

            // Initialize sequentially to ensure stability
            await this.initDatabase('knowledge');
            await this.initDatabase('calendar');
            await this.initDatabase('memory');
            await this.initDatabase('meeting');

            this.isInitialized = true;
            logger.log('info', '[DatabaseManager] All databases initialized successfully');
        } catch (error) {
            logger.log('error', '[DatabaseManager] Failed to initialize databases', error);
            throw error;
        }
    }

    /**
     * Initialize a specific database by type
     */
    private async initDatabase(type: DatabaseType): Promise<SQLiteDBConnection> {
        // 1. Return existing promise if initialization is in progress
        if (this.initPromises.has(type)) {
            return this.initPromises.get(type)!;
        }

        // 2. Return existing connection if valid
        if (this.connections.has(type)) {
            const db = this.connections.get(type)!;
            try {
                // Verify connection is actually alive
                const isConn = await this.sqliteConnection?.isConnection(DB_CONFIGS[type].name, false);
                if (isConn?.result) {
                    return db;
                }
                logger.log('warn', `[DatabaseManager] Connection for ${type} lost, re-initializing`);
            } catch (e) {
                logger.log('warn', `[DatabaseManager] Error checking connection for ${type}`, e);
            }
        }

        // 3. Start new initialization
        const initPromise = (async () => {
            this.initSQLiteConnection();
            const config = DB_CONFIGS[type];

            try {
                // Check if connection exists in SQLite plugin state
                const isConn = await this.sqliteConnection?.isConnection(config.name, false);

                // If it exists, retrieve it; otherwise create it
                let db: SQLiteDBConnection;

                if (isConn?.result) {
                    try {
                        // Retrieve existing connection
                        db = await this.sqliteConnection!.retrieveConnection(config.name, false);
                    } catch (retrieveError) {
                        // If retrieve fails (e.g. inconsistent state), close and recreate
                        logger.log('warn', `[DatabaseManager] Failed to retrieve existing ${type} connection, closing and recreating...`, retrieveError);
                        await this.sqliteConnection!.closeConnection(config.name, false);
                        db = await this.sqliteConnection!.createConnection(
                            config.name,
                            config.encrypted,
                            config.mode,
                            config.version,
                            false
                        );
                    }
                } else {
                    // Create new connection
                    db = await this.sqliteConnection!.createConnection(
                        config.name,
                        config.encrypted,
                        config.mode,
                        config.version,
                        false
                    );
                }

                // Open the database
                await db.open();

                // Enable WAL mode — must use query() instead of execute() or run()
                // because execute() wraps in a transaction, and PRAGMA journal_mode
                // cannot be changed from within a transaction.
                // Furthermore, it must be query() because PRAGMA journal_mode returns data.
                await db.query('PRAGMA journal_mode = DELETE;');
                await db.query('PRAGMA synchronous = NORMAL;');      // Safe + faster than FULL
                await db.query('PRAGMA cache_size = -8000;');        // 8MB page cache
                await db.query('PRAGMA foreign_keys = ON;');
                await db.query('PRAGMA wal_autocheckpoint = 1000;'); // Checkpoint every 1000 pages
                await db.query('PRAGMA busy_timeout = 5000;');       // Wait up to 5s on SQLITE_BUSY

                logger.log('info', `[DatabaseManager] Opened ${type} database (WAL mode)`);

                this.connections.set(type, db);
                return db;

            } catch (error) {
                logger.log('error', `[DatabaseManager] Failed to initialize ${type}`, error);
                throw error;
            } finally {
                this.initPromises.delete(type);
            }
        })();

        this.initPromises.set(type, initPromise);
        return initPromise;
    }

    /**
     * Get an active database connection. 
     * Will attempt to initialize if not found.
     */
    public async getDatabase(type: DatabaseType): Promise<SQLiteDBConnection> {
        // Fast path: return existing connection
        if (this.connections.has(type)) {
            return this.connections.get(type)!;
        }

        // Slow path: initialize and return
        logger.log('warn', `[DatabaseManager] Connection for ${type} not ready, performing on-demand init`);
        return this.initDatabase(type);
    }

    /**
     * Check if a specific database is initialized
     */
    public isDatabaseReady(type: DatabaseType): boolean {
        return this.connections.has(type);
    }

    /**
     * Close all connections (e.g. on app pause)
     */
    public async closeAll(): Promise<void> {
        logger.log('info', '[DatabaseManager] Closing all connections');

        const closePromises = Array.from(this.connections.keys()).map(async (type) => {
            const db = this.connections.get(type);
            if (db) {
                try {
                    await db.close();
                    const config = DB_CONFIGS[type as DatabaseType];
                    await this.sqliteConnection?.closeConnection(config.name, false);
                } catch (e) {
                    logger.log('warn', `[DatabaseManager] Error closing ${type}`, e);
                }
            }
        });

        await Promise.all(closePromises);

        this.connections.clear();
        this.isInitialized = false;
        logger.log('info', '[DatabaseManager] All connections closed');
    }

    /**
     * Re-initialize all connections (e.g. on app resume)
     */
    public async reInitializeAll(): Promise<void> {
        logger.log('info', '[DatabaseManager] Re-initializing all databases after resume');
        // Close any stale connections first to be safe
        await this.closeAll();
        // Re-init
        await this.initializeAll();
    }

    /**
     * Serialize all writes through a queue.
     * WAL handles concurrent reads natively; writes still need to be serialized
     * to prevent SQLITE_BUSY errors.
     */
    public async serializedWrite<T>(type: DatabaseType, operation: (db: SQLiteDBConnection) => Promise<T>): Promise<T> {
        const db = await this.getDatabase(type);
        return new Promise<T>((resolve, reject) => {
            this.writeQueue.push(async () => {
                try {
                    resolve(await operation(db));
                } catch (err) {
                    reject(err);
                }
            });
            this.processWriteQueue();
        });
    }

    private async processWriteQueue(): Promise<void> {
        if (this.isWriting || this.writeQueue.length === 0) return;
        this.isWriting = true;
        const next = this.writeQueue.shift()!;
        try {
            await next();
        } finally {
            this.isWriting = false;
            this.processWriteQueue();
        }
    }

    /**
     * Trigger WAL checkpoint. Called when app goes to background.
     */
    public async walCheckpoint(): Promise<void> {
        for (const [type, db] of this.connections) {
            try {
                await db.query('PRAGMA wal_checkpoint(PASSIVE);');
                logger.log('info', `[DatabaseManager] WAL checkpoint completed for ${type}`);
            } catch (e) {
                logger.log('warn', `[DatabaseManager] WAL checkpoint failed for ${type}`, e);
            }
        }
    }

    /**
     * Initialize app lifecycle listener for WAL checkpoint on background
     */
    public initLifecycleListeners(): void {
        App.addListener('appStateChange', async ({ isActive }) => {
            if (!isActive && this.isInitialized) {
                await this.walCheckpoint();
            }
        });
    }
}
