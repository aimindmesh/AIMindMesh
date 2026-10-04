import React, { useEffect, useRef } from 'react';

interface ToastProps {
    message: string;
    isVisible: boolean;
    onClose: () => void;
    duration?: number;
    type?: 'success' | 'error' | 'info';
}

const Toast: React.FC<ToastProps> = ({
    message,
    isVisible,
    onClose,
    duration = 3000,
    type = 'success'
}) => {
    // Callers pass a new onClose on every render; depending on it would restart the timer at
    // each re-render (several per second while recording) and the toast would never close.
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        if (isVisible) {
            const timer = setTimeout(() => {
                onCloseRef.current();
            }, duration);
            return () => clearTimeout(timer);
        }
    }, [isVisible, message, duration]);

    if (!isVisible) return null;

    const bgColors = {
        success: 'bg-green-600',
        error: 'bg-red-600',
        info: 'bg-blue-600'
    };

    return (
        <div className={`fixed bottom-20 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-full shadow-lg z-50 flex items-center space-x-2 ${bgColors[type]} text-white transition-opacity duration-300 animate-fade-in-up`}>
            {type === 'success' && <span>✅</span>}
            {type === 'error' && <span>❌</span>}
            {type === 'info' && <span>ℹ️</span>}
            <span className="font-medium text-sm">{message}</span>
        </div>
    );
};

export default Toast;
