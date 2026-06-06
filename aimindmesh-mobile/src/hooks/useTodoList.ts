import { useCallback } from 'react';
import { useLocalStorage } from './useLocalStorage';
import { TodoItem } from '../services/todoTypes';

export interface UseTodoListReturn {
    todos: TodoItem[];
    addTodo: (text: string) => TodoItem;
    completeTodo: (id: string) => boolean;
    deleteTodo: (id: string) => void;
    getActiveTodos: () => TodoItem[];
    getAllTodos: () => TodoItem[];
}

export function useTodoList(): UseTodoListReturn {
    const [todos, setTodos] = useLocalStorage<TodoItem[]>('todo-items', []);

    const addTodo = useCallback((text: string): TodoItem => {
        const newTodo: TodoItem = {
            id: Date.now().toString(),
            text: text.trim(),
            createdAt: new Date(),
        };

        setTodos(prev => [...prev, newTodo]);
        return newTodo;
    }, [setTodos]);

    const completeTodo = useCallback((id: string): boolean => {
        let found = false;
        setTodos(prev => {
            const todo = prev.find(t => t.id === id);
            if (todo && !todo.completedAt) {
                found = true;
                return prev.map(t =>
                    t.id === id ? { ...t, completedAt: new Date() } : t
                );
            }
            return prev;
        });
        return found;
    }, [setTodos]);

    const deleteTodo = useCallback((id: string): void => {
        setTodos(prev => prev.filter(t => t.id !== id));
    }, [setTodos]);

    const getActiveTodos = useCallback((): TodoItem[] => {
        return todos.filter(t => !t.completedAt);
    }, [todos]);

    const getAllTodos = useCallback((): TodoItem[] => {
        return todos;
    }, [todos]);

    return {
        todos,
        addTodo,
        completeTodo,
        deleteTodo,
        getActiveTodos,
        getAllTodos,
    };
}
