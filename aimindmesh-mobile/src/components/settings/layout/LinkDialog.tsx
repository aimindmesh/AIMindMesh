import React from 'react';
import { CloseIcon } from '../../../constants';

interface LinkDialogProps {
    show: boolean;
    onClose: () => void;
    title: string;
    urls: { label: string, url: string }[];
    onCopy: (url: string) => Promise<void>;
}

const LinkDialog: React.FC<LinkDialogProps> = ({ show, onClose, title, urls, onCopy }) => {
    if (!show) return null;

    return (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-background rounded-lg shadow-xl w-full max-w-lg border border-white/10" onClick={(e) => e.stopPropagation()}>
                <div className="p-4 border-b border-surface flex justify-between items-center">
                    <h3 className="text-lg font-bold text-primary">{title}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <CloseIcon />
                    </button>
                </div>
                <div className="p-6 space-y-4">
                    {urls.map((item, index) => (
                        <div key={index} className="space-y-2">
                            <label className="text-sm font-medium text-text-primary">{item.label}</label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    readOnly
                                    value={item.url}
                                    className="flex-1 bg-surface border-white/10 rounded px-3 py-2 text-xs text-text-secondary font-mono"
                                />
                                <button
                                    onClick={() => onCopy(item.url)}
                                    className="px-4 py-2 bg-primary hover:bg-primary/80 text-white rounded text-sm font-medium"
                                >
                                    Copy
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="p-4 border-t border-surface flex justify-end">
                    <button onClick={onClose} className="px-4 py-2 bg-surface hover:bg-surface/80 rounded text-text-primary">
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default LinkDialog;
