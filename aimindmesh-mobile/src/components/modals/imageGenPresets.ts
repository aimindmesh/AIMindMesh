export type StylePreset = 'photorealistic' | 'outdoor' | 'cinematic' | 'digital_art' | 'anime' | 'raw';

export interface StylePresetConfig {
    id: StylePreset;
    label: string;
    icon: string;
    promptSuffix: string;
    negative: string;
}

export const STYLE_PRESETS: StylePresetConfig[] = [
    {
        id: 'photorealistic',
        label: 'Photo',
        icon: '📸',
        promptSuffix: ', 8k uhd, dslr, high quality, soft lighting, photorealistic',
        negative: 'cartoon, anime, 3d render, illustration, drawing, painting, vector, low quality, bad anatomy, deformed, oversaturated'
    },
    {
        id: 'outdoor',
        label: 'Outdoor',
        icon: '🏞️',
        promptSuffix: ', sunny outdoor natural scene, garden environment, daylight, highly detailed, photorealistic 8k',
        negative: 'indoor, interior, room, window, bedroom, house, wall, cartoon, drawing, painting, 3d render, low quality'
    },
    {
        id: 'cinematic',
        label: 'Cinema',
        icon: '🎬',
        promptSuffix: ', 35mm film photograph, cinematic lighting, dramatic atmosphere, detailed textures, 8k',
        negative: 'low quality, blurry, drawing, cartoon, painting, 3d render, deformed'
    },
    {
        id: 'digital_art',
        label: 'Digital Art',
        icon: '🎨',
        promptSuffix: ', vibrant digital concept art, sharp focus, octane render, masterpiece',
        negative: 'photo, realistic, low quality, sketch, messy, deformed'
    },
    {
        id: 'anime',
        label: 'Anime',
        icon: '🌸',
        promptSuffix: ', anime visual art, studio ghibli style, detailed anime illustration, masterpiece',
        negative: 'photo, realistic, 3d render, deformed, low quality'
    },
    {
        id: 'raw',
        label: 'Raw',
        icon: '⚙️',
        promptSuffix: '',
        negative: 'low quality, blurry, deformed'
    }
];
