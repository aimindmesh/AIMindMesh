export interface TodoItem {
    id: string;
    text: string;
    createdAt: Date;
    completedAt?: Date;
}
