import React, { useState } from 'react';
import { triggerHaptic } from '../../../services/native';

interface AddMemorySectionProps {
    onAddMemory: (content: string, category?: string) => void;
    memoryCategories: string[];
}

export const AddMemorySection: React.FC<AddMemorySectionProps> = ({
    onAddMemory,
    memoryCategories
}) => {
    const [newMemoryInput, setNewMemoryInput] = useState('');
    const [selectedCategoryForAdd, setSelectedCategoryForAdd] = useState('other');

    const handleAddMemory = () => {
        if (newMemoryInput.trim()) {
            triggerHaptic();
            onAddMemory(newMemoryInput, selectedCategoryForAdd);
            setNewMemoryInput('');
        }
    };

    return (
        <div className="mb-4">
            <h3 className="text-sm font-medium text-text-primary mb-2">Add Memory</h3>
            <div className="flex flex-col space-y-2">
                <input
                    type="text"
                    value={newMemoryInput}
                    onChange={(e) => setNewMemoryInput(e.target.value)}
                    placeholder="e.g., User likes coffee."
                    className="block w-full bg-input border-surface rounded-md shadow-sm py-2 px-3 text-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddMemory()}
                />
                <div className="flex space-x-2">
                    <select
                        value={selectedCategoryForAdd}
                        onChange={(e) => setSelectedCategoryForAdd(e.target.value)}
                        className="bg-input border-surface rounded-md text-xs px-2 py-2 text-text-secondary focus:outline-none"
                    >
                        {memoryCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                    <button onClick={handleAddMemory} className="flex-1 bg-primary text-white rounded-md text-sm font-semibold hover:bg-primary/80">Add</button>
                </div>
            </div>
        </div>
    );
};
