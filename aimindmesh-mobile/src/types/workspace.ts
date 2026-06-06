export interface Workspace {
    id: number;
    name: string;
    description?: string;
    color: string;
    icon: string;
    is_active: boolean;
    created_at: number;
    last_used?: number;
    settings: WorkspaceSettings;

    // Computed fields (optional in DB, populated in Service)
    document_count?: number;
    thread_count?: number;
}

export interface WorkspaceSettings {
    auto_inject: boolean;        // Auto-inject docs in every query
    max_chunks: number;           // Max chunks to retrieve (default: 5)
    search_strategy: 'hybrid' | 'vector' | 'keyword';
    include_metadata: boolean;    // Include doc metadata in context
    min_similarity: number;       // Threshold (0.0-1.0)
}

export interface CreateWorkspaceInput {
    name: string;
    description?: string;
    color?: string;
    icon?: string;
    settings?: Partial<WorkspaceSettings>;
}

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
    auto_inject: true,
    max_chunks: 5,
    search_strategy: 'hybrid',
    include_metadata: true,
    min_similarity: 0.60
};
