
import React from 'react';
import { ProactiveAction } from '../../types/proactive';

interface SuggestionCardProps {
    action: ProactiveAction;
    onAccept: (action: ProactiveAction) => void;
    onDismiss: (action: ProactiveAction) => void;
}

export const SuggestionCard: React.FC<SuggestionCardProps> = ({ action, onAccept, onDismiss }) => {
    return (
        <div className="bg-surface/80 backdrop-blur-md rounded-xl p-4 border border-white/10 shadow-lg animate-in slide-in-from-bottom-4 duration-300">
            <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-full bg-primary/10 text-primary">
                        {getIconForAction(action.category)}
                    </div>
                    <span className="text-xs font-medium text-textSecondary uppercase tracking-wider">
                        {action.category} Suggestion
                    </span>
                </div>
                <button
                    onClick={() => onDismiss(action)}
                    className="text-textSecondary hover:text-white transition-colors"
                >
                    ✕
                </button>
            </div>

            <h3 className="text-lg font-semibold text-textPrimary mb-1">
                {action.data.title || 'Suggestion'}
            </h3>
            <p className="text-sm text-textSecondary mb-4">
                {action.data.message || action.data.description || 'Verified suggestion from your AI assistant.'}
            </p>

            <div className="flex gap-2 justify-end">
                <button
                    onClick={() => onDismiss(action)}
                    className="px-3 py-1.5 text-sm font-medium text-textSecondary hover:text-white transition-colors"
                >
                    Dismiss
                </button>
                <button
                    onClick={() => onAccept(action)}
                    className="px-3 py-1.5 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-1.5 shadow-glow-sm"
                >
                    ✓
                    {action.requiresConfirmation ? 'Confirm' : 'Accept'}
                </button>
            </div>
        </div>
    );
};

function getIconForAction(category: string) {
    switch (category) {
        case 'interactive': return <span>💬</span>;
        case 'suggestive': return <span>💡</span>;
        default: return <span>💡</span>;
    }
}
