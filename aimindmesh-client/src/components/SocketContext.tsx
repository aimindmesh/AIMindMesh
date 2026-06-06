import { createContext, useContext, ReactNode } from 'react';
import { useSocketManager } from '../hooks/useSocketManager';

interface SocketContextType {
    isConnected: boolean;
    subscribe: (callback: (data: any) => void) => () => void;
    send: (data: any) => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export function SocketProvider({ children }: { children: ReactNode }) {
    const socket = useSocketManager();

    return (
        <SocketContext.Provider value={socket}>
            {children}
        </SocketContext.Provider>
    );
}

export function useSocket() {
    const context = useContext(SocketContext);
    if (context === undefined) {
        throw new Error('useSocket must be used within a SocketProvider');
    }
    return context;
}
