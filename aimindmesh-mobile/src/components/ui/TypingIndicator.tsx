import React from 'react';

const TypingIndicator: React.FC = () => {
    return (
        <div className="flex justify-start">
            <div className="px-4 py-3 rounded-t-2xl rounded-br-2xl bg-bubble-model flex items-center space-x-1.5">
                <div className="w-2 h-2 bg-text-secondary rounded-full animate-pulse"></div>
                <div className="w-2 h-2 bg-text-secondary rounded-full animate-pulse [animation-delay:0.2s]"></div>
                <div className="w-2 h-2 bg-text-secondary rounded-full animate-pulse [animation-delay:0.4s]"></div>
            </div>
        </div>
    );
};

export default TypingIndicator;
