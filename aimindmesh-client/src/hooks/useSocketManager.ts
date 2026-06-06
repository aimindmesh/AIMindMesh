import { useEffect, useRef, useState } from 'react';
import { WSClient } from '../services/wsClient';
import { useConfigStore } from '../store/configStore';
import { useFeedStore } from '../store/feedStore';
import { Logger } from '../utils/logger';

export function useSocketManager() {
    const config = useConfigStore(state => state.config);
    const addInsight = useFeedStore(state => state.addInsight);
    const [isConnected, setIsConnected] = useState(false);
    const wsRef = useRef<WSClient | null>(null);
    const subscribers = useRef<Set<(data: any) => void>>(new Set());

    useEffect(() => {
        if (!config?.server?.url || !config?.server?.api_key) return;

        const client = new WSClient('/ws/chat', (data) => {
            // Global listeners
            if (data.type === 'new_insight') {
                Logger.info('SocketManager', 'New insight received via WebSocket', data.data);
                addInsight({
                    id: data.data.id,
                    text: data.data.content,
                    timestamp: data.timestamp || Date.now(),
                    concepts: [],
                    unread: true
                });
            }

            // Notify subscribers (like ChatView)
            subscribers.current.forEach(callback => callback(data));
        }, () => {
            setIsConnected(false);
        });

        wsRef.current = client;
        client.connect();
        setIsConnected(true);

        return () => {
            client.disconnect();
        };
    }, [config?.server?.url, config?.server?.api_key, addInsight]);

    const subscribe = (callback: (data: any) => void) => {
        subscribers.current.add(callback);
        return () => subscribers.current.delete(callback);
    };

    const send = (data: any) => {
        wsRef.current?.send(data);
    };

    return { isConnected, subscribe, send };
}
