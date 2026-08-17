import { Type } from '@google/genai';
import { executeTermuxCommand } from '../termuxPlugin';
import { ToolDefinition, ToolResult } from './types';
import { imageGenService } from '../image/imageGenService';

export const mediaTools: ToolDefinition[] = [
    {
        name: 'generate_image',
        description: 'Generates or edits an image locally on device using the Qualcomm Hexagon NPU (Stable Diffusion). Use this whenever the user asks to draw, generate, visualize, or modify an image.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                prompt: {
                    type: Type.STRING,
                    description: 'Detailed description of the image to generate or modification instructions'
                },
                negative_prompt: {
                    type: Type.STRING,
                    description: 'Negative prompt specifying elements to avoid (optional)'
                },
                source_image: {
                    type: Type.STRING,
                    description: 'Optional base64 or file path of the source image to modify (for image-to-image editing)'
                },
                strength: {
                    type: Type.NUMBER,
                    description: 'Denoising / edit intensity between 0.1 (subtle) and 0.9 (drastic), default 0.65'
                }
            },
            required: ['prompt']
        },
        requiresConfirmation: false,
        category: 'media'
    },
    {
        name: 'take_photo',
        description: 'Takes a photo using the device camera and saves it to storage.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                camera_facing: {
                    type: Type.STRING,
                    description: 'Camera to use: "front" or "back"',
                    enum: ['front', 'back']
                }
            },
            required: ['camera_facing']
        },
        requiresConfirmation: true,
        category: 'media'
    },
    {
        name: 'record_audio',
        description: 'Records audio from microphone for specified duration and saves to storage.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                duration_seconds: {
                    type: Type.INTEGER,
                    description: 'Recording duration in seconds (max 60)'
                },
                filename: {
                    type: Type.STRING,
                    description: 'Optional custom filename (must end in .wav)'
                }
            },
            required: ['duration_seconds']
        },
        requiresConfirmation: true,
        category: 'media'
    }
];

export async function executeGenerateImage(args: Record<string, unknown>): Promise<ToolResult> {
    const prompt = (args.prompt as string) || '';
    if (!prompt.trim()) {
        return {
            success: false,
            message: 'Image prompt cannot be empty.'
        };
    }

    try {
        const result = await imageGenService.generateImage({
            prompt: prompt.trim(),
            negativePrompt: (args.negative_prompt as string) || undefined,
            sourceImage: (args.source_image as string) || undefined,
            strength: typeof args.strength === 'number' ? args.strength : undefined
        });

        return {
            success: true,
            message: `Image generated on Qualcomm Hexagon NPU (${result.generationTimeMs}ms) for prompt: "${prompt}"`,
            data: {
                base64Image: result.base64Image,
                generationTimeMs: result.generationTimeMs,
                width: result.width,
                height: result.height
            }
        };
    } catch (e: any) {
        return {
            success: false,
            message: `Qualcomm NPU Image generation failed: ${e.message || 'Unknown error'}`
        };
    }
}

export async function executeRecordAudio(args: Record<string, unknown>): Promise<ToolResult> {
    const durationSeconds = Math.min((args.duration_seconds as number) || 10, 60);
    const customFilename = args.filename as string;

    const filename = customFilename || `recording_${new Date().getTime()}.wav`;
    const targetDir = '/storage/emulated/0/Documents/AI_Companion_Audio';
    const targetFile = `${targetDir}/${filename}`;

    // Create directory and record
    const cmd = `mkdir -p ${targetDir} && termux-microphone-record -f '${targetFile}' -l ${durationSeconds}`;

    const result = await executeTermuxCommand(cmd);

    if (result.success || result.exitCode === 0) {
        return {
            success: true,
            message: `Recording started for ${durationSeconds} seconds. File: ${filename}`,
            data: {
                path: targetFile,
                filename,
                duration: durationSeconds
            }
        };
    } else {
        return {
            success: false,
            message: `Recording failed: ${result.stderr || 'Unknown error'}`
        };
    }
}

export async function executeTakePhoto(args: Record<string, unknown>): Promise<ToolResult> {
    const facing = (args.camera_facing as string) || 'back';
    const cameraId = facing === 'front' ? '1' : '0';

    // Create a timestamped filename
    const filename = `photo_${new Date().getTime()}.jpg`;
    const targetDir = '/storage/emulated/0/Documents/AI_Companion_Photos';
    const targetFile = `${targetDir}/${filename}`;

    // Ensure dir exists
    const mkdirCmd = `mkdir -p ${targetDir}`;
    const cmd = `${mkdirCmd} && termux-camera-photo -c ${cameraId} '${targetFile}'`;

    const result = await executeTermuxCommand(cmd);

    if (result.success) {
        return {
            success: true,
            message: `Photo taken and saved to ${targetFile}`,
            data: {
                path: targetFile,
                filename,
                facing
            }
        };
    } else {
        return {
            success: false,
            message: `Camera error: ${result.stderr || 'Unknown error'}`
        };
    }
}
