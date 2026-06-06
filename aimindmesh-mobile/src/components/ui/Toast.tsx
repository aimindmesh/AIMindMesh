import React, { useEffect } from 'react';

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
    useEffect(() => {
        if (isVisible) {
            const timer = setTimeout(() => {
                onClose();
            }, duration);
            return () => clearTimeout(timer);
        }
    }, [isVisible, duration, onClose]);

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
