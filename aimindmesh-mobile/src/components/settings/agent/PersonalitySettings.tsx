import React from 'react';
import { Personality, ProactiveFrequency } from '../../../types';
import { PRESET_PERSONALITIES, TrashIcon } from '../../../constants';
import { triggerHaptic } from '../../../services/native';

interface PersonalitySettingsProps {
    personality: Personality;
    onPersonalitySave: (newPersonality: Personality) => void;
    selectedPersonalityId: string;
    onSelectedPersonalityIdChange: (id: string) => void;
    customPersonalities: Record<string, Personality>;
    onSaveCustomPersonality: (id: string, personality: Personality) => void;
    onDeleteCustomPersonality: (id: string) => void;
    proactiveFrequency: ProactiveFrequency;
    onProactiveFrequencyChange: (value: ProactiveFrequency) => void;
}

const PersonalitySettings: React.FC<PersonalitySettingsProps> = ({
    personality,
    onPersonalitySave,
    selectedPersonalityId,
    onSelectedPersonalityIdChange,
    customPersonalities,
    onSaveCustomPersonality,
    onDeleteCustomPersonality,
    proactiveFrequency,
    onProactiveFrequencyChange
}) => {
    // Local state for editing personality properties
    const handlePersonalityChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        onPersonalitySave({ ...personality, [name]: value });
    };

    const handleProactiveFreqChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onProactiveFrequencyChange(e.target.value as ProactiveFrequency);
    };

    const createNewPersonality = () => {
        const newId = `custom_${Date.now()}`;
        const newPersonality: Personality = {
            name: 'New Personality',
            description: 'A custom personality',
            systemPrompt: 'You are a helpful assistant.',
            traits: ['helpful']
        };
        onSaveCustomPersonality(newId, newPersonality);
        onSelectedPersonalityIdChange(newId);
        onPersonalitySave(newPersonality);
        triggerHaptic();
    };

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Personality Selector (Preset + Custom) */}
            <fieldset>
                <legend className="text-base font-medium textPrimary mb-3">Personality</legend>

                {/* All Personalities (Preset + Custom) */}
                <div className="space-y-3 mb-4">
                    {Object.entries({ ...PRESET_PERSONALITIES, ...customPersonalities }).map(([id, preset]) => {
                        const isPreset = id in PRESET_PERSONALITIES;
                        const isCustom = id in customPersonalities;

                        return (
                            <div
                                key={id}
                                className={`flex items-start p-3 rounded-lg border transition-all ${selectedPersonalityId === id
                                    ? 'bg-primary/10 border-primary/40'
                                    : 'bg-surface/30 border-white/5 hover:border-primary/20'
                                    }`}
                            >
                                <input
                                    type="radio"
                                    id={`personality_${id}`}
                                    name="personalityPreset"
                                    value={id}
                                    checked={selectedPersonalityId === id}
                                    onChange={() => {
                                        triggerHaptic();
                                        onSelectedPersonalityIdChange(id);
                                        onPersonalitySave(preset);
                                    }}
                                    className="h-4 w-4 mt-0.5 text-primary bg-input border-surface focus:ring-primary flex-shrink-0 cursor-pointer"
                                />
                                <label
                                    htmlFor={`personality_${id}`}
                                    className="ml-3 flex-1 cursor-pointer"
                                    onClick={() => {
                                        triggerHaptic();
                                        onSelectedPersonalityIdChange(id);
                                        onPersonalitySave(preset);
                                    }}
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <div className="font-medium textPrimary">{preset.name}</div>
                                        {isPreset && (
                                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                                                Preset
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-xs textSecondary mb-2">{preset.description}</div>
                                    <div className="flex flex-wrap gap-1">
                                        {preset.traits.map((trait, idx) => (
                                            <span
                                                key={idx}
                                                className="text-[10px] px-2 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30"
                                            >
                                                {trait}
                                            </span>
                                        ))}
                                    </div>
                                </label>

                                {/* Delete button for custom personalities */}
                                {isCustom && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (window.confirm(`Eliminare la personalità "${preset.name}"?`)) {
                                                triggerHaptic();
                                                onDeleteCustomPersonality(id);
                                                // If we're deleting the currently selected personality, switch to default
                                                if (selectedPersonalityId === id) {
                                                    onSelectedPersonalityIdChange('aria');
                                                    onPersonalitySave(PRESET_PERSONALITIES.aria);
                                                }
                                            }
                                        }}
                                        className="ml-2 p-1.5 text-red-400 hover:bg-red-500/10 rounded transition-colors"
                                        title="Elimina personalità"
                                    >
                                        <TrashIcon className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Create New Personality Button */}
                <button
                    onClick={createNewPersonality}
                    className="w-full py-2 px-4 bg-surface hover:bg-surface/80 border border-white/10 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                    <span>+ Create New Personality</span>
                </button>
            </fieldset>

            <div className="border-t border-white/10 my-4"></div>

            {/* Basic Info (Editable) */}
            <h3 className="text-sm font-medium textSecondary uppercase tracking-wider mb-3">
                Personality Details
                {selectedPersonalityId in PRESET_PERSONALITIES && <span className="ml-2 text-xs normal-case text-amber-400">(Temporary changes for preset)</span>}
            </h3>

            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium textSecondary mb-1">Name</label>
                    <input
                        type="text"
                        name="name"
                        value={personality.name}
                        onChange={handlePersonalityChange}
                        className="w-full bg-input border border-surface rounded-md px-3 py-2 text-textPrimary placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium textSecondary mb-1">Description</label>
                    <input
                        type="text"
                        name="description"
                        value={personality.description}
                        onChange={handlePersonalityChange}
                        className="w-full bg-input border border-surface rounded-md px-3 py-2 text-textPrimary placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium textSecondary mb-1">System Prompt (Instructions)</label>
                    <textarea
                        name="systemPrompt"
                        value={personality.systemPrompt}
                        onChange={handlePersonalityChange}
                        rows={6}
                        className="w-full bg-input border border-surface rounded-md px-3 py-2 text-textPrimary placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                    <p className="mt-1 text-xs textSecondary">
                        Define the AI's role, tone, and behavior constraints.
                    </p>
                </div>
            </div>

            <div className="border-t border-white/10 my-6"></div>

            {/* Proactive Behavior Section */}
            <fieldset>
                <legend className="text-base font-medium textPrimary mb-3">Proactive Behavior</legend>
                <p className="text-sm textSecondary mb-4">
                    Decide how often the AI should contact you spontaneously.
                </p>

                <div className="grid grid-cols-4 gap-3">
                    {(['off', 'low', 'medium', 'high'] as const).map((freq) => (
                        <div key={freq} className="relative">
                            <input
                                type="radio"
                                id={`freq_${freq}`}
                                name="proactiveFrequency"
                                value={freq}
                                checked={proactiveFrequency === freq}
                                onChange={handleProactiveFreqChange}
                                className="peer sr-only"
                            />
                            <label
                                htmlFor={`freq_${freq}`}
                                onClick={() => triggerHaptic()}
                                className={`flex flex-col items-center justify-center p-3 rounded-lg border cursor-pointer transition-all h-full
                    ${proactiveFrequency === freq
                                        ? 'bg-primary/20 border-primary text-white'
                                        : 'bg-surface/50 border-white/5 text-gray-400 hover:bg-surface hover:text-gray-200'
                                    }`}
                            >
                                <span className="capitalize font-medium">{freq}</span>
                            </label>
                        </div>
                    ))}
                </div>
                <p className="mt-2 text-xs textSecondary">
                    {proactiveFrequency === 'off' && "The AI will never contact you spontaneously."}
                    {proactiveFrequency === 'low' && "Some occasional messages during the day."}
                    {proactiveFrequency === 'medium' && "Moderate and useful interactions."}
                    {proactiveFrequency === 'high' && "Very active, ideal for brainstorming or company."}
                </p>
            </fieldset>
        </div>
    );
};

export default PersonalitySettings;
