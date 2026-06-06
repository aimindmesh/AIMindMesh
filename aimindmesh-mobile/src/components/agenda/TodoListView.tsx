import React, { useState } from 'react';
import { TodoItem } from '../../services/todoTypes';

interface TodoListViewProps {
    isOpen: boolean;
    onClose: () => void;
    todos: TodoItem[];
    onCompleteTodo: (id: string) => void;
    onAddTodo: (text: string) => void;
    onDeleteTodo: (id: string) => void;
}

const TodoListView: React.FC<TodoListViewProps> = ({
    isOpen,
    onClose,
    todos,
    onCompleteTodo,
    onAddTodo,
    onDeleteTodo,
}) => {
    const [newTaskText, setNewTaskText] = useState('');

    if (!isOpen) return null;

    const activeTodos = todos.filter(t => !t.completedAt);

    const handleAddTask = () => {
        if (newTaskText.trim()) {
            onAddTodo(newTaskText.trim());
            setNewTaskText('');
        }
    };

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center animate-fade-in">
            <div className="bg-surface w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[85vh] flex flex-col animate-slide-up pb-safe">
                {/* Header */}
                <div className="flex justify-between items-center p-6 border-b border-white/10">
                    <h2 className="text-2xl font-bold text-text-primary flex items-center gap-2">
                        <svg className="w-7 h-7 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                        To Do List
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-text-secondary hover:text-text-primary p-2 rounded-full hover:bg-white/10 transition-colors"
                        aria-label="Close"
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Add Task Input */}
                <div className="p-4 border-b border-white/10 bg-surface/50">
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={newTaskText}
                            onChange={(e) => setNewTaskText(e.target.value)}
                            onKeyPress={(e) => {
                                if (e.key === 'Enter') {
                                    handleAddTask();
                                }
                            }}
                            placeholder="Add a new task..."
                            className="flex-1 bg-white/5 text-text-primary placeholder-text-secondary/60 rounded-lg px-4 py-2 border border-white/10 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all"
                        />
                        <button
                            onClick={handleAddTask}
                            disabled={!newTaskText.trim()}
                            className="bg-primary hover:bg-primary/80 disabled:bg-primary/30 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors font-medium"
                        >
                            Add
                        </button>
                    </div>
                </div>

                {/* Todo List */}
                <div className="flex-1 overflow-y-auto p-6 space-y-3">
                    {activeTodos.length === 0 ? (
                        <div className="text-center py-12">
                            <svg className="w-20 h-20 mx-auto text-text-secondary/30 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <p className="text-text-secondary text-lg">
                                Nothing to do!
                            </p>
                            <p className="text-text-secondary/70 text-sm mt-2">
                                Use the field above or ask the assistant
                            </p>
                        </div>
                    ) : (
                        activeTodos.map((todo) => (
                            <div
                                key={todo.id}
                                className="bg-gradient-to-r from-white/5 to-white/10 rounded-xl p-4 border border-white/10 hover:border-primary/30 transition-all group"
                            >
                                <div className="flex items-start gap-3">
                                    <button
                                        onClick={() => onCompleteTodo(todo.id)}
                                        className="mt-1 flex-shrink-0 w-6 h-6 rounded-full border-2 border-primary/50 hover:border-primary hover:bg-primary/20 transition-all group-hover:scale-110"
                                        aria-label={`Complete: ${todo.text}`}
                                        title="Mark as completed"
                                    >
                                        <svg className="w-full h-full text-primary opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                        </svg>
                                    </button>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-text-primary font-medium text-base leading-relaxed break-words">
                                            {todo.text}
                                        </p>
                                        <p className="text-text-secondary/60 text-xs mt-1">
                                            {new Date(todo.createdAt).toLocaleDateString('en-US', {
                                                day: 'numeric',
                                                month: 'short',
                                                hour: '2-digit',
                                                minute: '2-digit'
                                            })}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => onDeleteTodo(todo.id)}
                                        className="flex-shrink-0 p-1.5 text-red-400/60 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                        aria-label={`Delete: ${todo.text}`}
                                        title="Delete task"
                                    >
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Footer */}
                {activeTodos.length > 0 && (
                    <div className="p-4 border-t border-white/10 bg-surface/50">
                        <p className="text-text-secondary text-sm text-center">
                            {activeTodos.length} {activeTodos.length === 1 ? 'task' : 'tasks'} to do
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TodoListView;
