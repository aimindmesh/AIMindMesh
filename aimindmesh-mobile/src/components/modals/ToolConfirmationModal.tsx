import React, { useState } from 'react';
import { ToolCall } from '../../services/tools';
import { getToolByName } from '../../services/toolDefinitions';

interface ToolConfirmationModalProps {
    call: ToolCall;
    onConfirm: (rememberValue: boolean) => void;
    onCancel: () => void;
}

const ToolConfirmationModal: React.FC<ToolConfirmationModalProps> = ({ call, onConfirm, onCancel }) => {
    const [remember, setRemember] = useState(false);
    const tool = getToolByName(call.name);

    React.useEffect(() => {
        console.log('[ToolConfirmationModal] Mounted/Updated:', { callName: call.name, foundTool: !!tool });
        // Dismiss keyboard on mobile
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }
    }, [call, tool]);

    // Fallback if tool definition not found
    const displayTool = tool || {
        name: call.name,
        description: `Unknown Tool: ${call.name}`,
        parameters: { properties: {}, required: [] },
        requiresConfirmation: true,
        category: 'system'
    };

    // Helper to format arguments into readable labels
    const formatArgs = (args: Record<string, any>) => {
        return Object.entries(args).map(([key, value]) => (
            <div key={key} className="flex flex-col mb-2">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{key.replace('_', ' ')}</span>
                <span className="text-sm text-gray-800 break-words">{String(value)}</span>
            </div>
        ));
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
                {/* Header */}
                <div className="px-6 py-4 bg-indigo-600 flex items-center">
                    <div className="p-2 bg-white/20 rounded-lg mr-3">
                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                    </div>
                    <h3 className="text-lg font-bold text-white uppercase tracking-tight">Action Required</h3>
                </div>

                {/* Content */}
                <div className="px-6 py-6">
                    <p className="text-gray-600 text-sm mb-4 leading-relaxed">
                        The assistant would like to execute the following action:
                        <span className="font-bold text-gray-800 block mt-1 text-base">{displayTool.description}</span>
                    </p>

                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 mb-6">

                        <h4 className="text-xs font-bold text-gray-400 uppercase mb-3 border-b border-gray-200 pb-1">Action Details</h4>
                        <div className="max-h-48 overflow-y-auto">
                            {formatArgs(call.args)}
                        </div>
                    </div>

                    {/* Remember Checkbox */}
                    <label className="flex items-center space-x-3 cursor-pointer group mb-2">
                        <div className="relative">
                            <input
                                type="checkbox"
                                className="sr-only"
                                checked={remember}
                                onChange={(e) => setRemember(e.target.checked)}
                            />
                            <div className={`w-5 h-5 border-2 rounded shrink-0 transition-colors ${remember ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300 group-hover:border-indigo-400'}`}>
                                {remember && (
                                    <svg className="w-full h-full text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                        <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                )}
                            </div>
                        </div>
                        <span className="text-sm text-gray-600 select-none">Do not ask again for this action</span>
                    </label>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-gray-50 flex space-x-3">
                    <button
                        onClick={onCancel}
                        className="flex-1 py-3 px-4 rounded-xl text-sm font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-200 transition-all active:scale-95"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => onConfirm(remember)}
                        className="flex-1 py-3 px-4 rounded-xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all active:scale-95"
                    >
                        Confirm
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ToolConfirmationModal;
