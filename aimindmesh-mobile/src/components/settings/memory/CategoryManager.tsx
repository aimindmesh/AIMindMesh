import React, { useState } from 'react';
import { DEFAULT_MEMORY_CATEGORIES } from '../../../types';

interface CategoryManagerProps {
    memoryCategories: string[];
    onAddMemoryCategory: (category: string) => void;
    onDeleteMemoryCategory: (category: string) => void;
    viewCategory: string;
    setViewCategory: (category: string) => void;
}

export const CategoryManager: React.FC<CategoryManagerProps> = ({
    memoryCategories,
    onAddMemoryCategory,
    onDeleteMemoryCategory,
    viewCategory,
    setViewCategory
}) => {
    const [newCategoryInput, setNewCategoryInput] = useState('');

    const handleAddCategory = () => {
        if (newCategoryInput.trim()) {
            onAddMemoryCategory(newCategoryInput);
            setNewCategoryInput('');
        }
    };

    return (
        <div className="mb-4">
            <div className="flex justify-between items-center mb-2">
                <h3 className="text-sm font-medium text-text-primary">Categories</h3>
            </div>
            <div className="flex space-x-2 mb-2">
                <input
                    type="text"
                    value={newCategoryInput}
                    onChange={(e) => setNewCategoryInput(e.target.value)}
                    placeholder="New category..."
                    className="flex-1 bg-input border-surface rounded-md py-1 px-2 text-xs"
                />
                <button onClick={handleAddCategory} className="px-3 py-1 bg-surface hover:bg-surface/80 rounded text-xs">Create</button>
            </div>
            <div className="flex flex-wrap gap-2">
                <button
                    onClick={() => setViewCategory('all')}
                    className={`px-2 py-1 rounded text-xs ${viewCategory === 'all' ? 'bg-primary text-white' : 'bg-surface text-text-secondary'}`}
                >
                    All
                </button>
                {memoryCategories.map(cat => (
                    <div key={cat} className="relative group">
                        <button
                            onClick={() => setViewCategory(cat)}
                            className={`px-2 py-1 rounded text-xs pr-4 ${viewCategory === cat ? 'bg-primary text-white' : 'bg-surface text-text-secondary'}`}
                        >
                            {cat}
                        </button>
                        {!DEFAULT_MEMORY_CATEGORIES.includes(cat as any) && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onDeleteMemoryCategory(cat); }}
                                className="absolute right-0 top-0 bottom-0 px-1 text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                ×
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};
