import { Type } from '@google/genai';
import { executeTermuxCommand } from '../termuxPlugin';
import { ToolDefinition, ToolResult } from './types';
import { shellQuote, clampInt } from './shellArgs';
import { imageGenService } from '../image/imageGenService';

export const mediaTools: ToolDefinition[] = [
    {
        name: 'generate_image',
        description: 'Generates an image, or edits one, locally on the device NPU with Stable Diffusion; the picture is shown to the user. Use it whenever the user asks to draw, generate, visualize or modify an image.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                prompt: {
                    type: Type.STRING,
                    description: 'In ENGLISH, comma-separated: what the final picture shows (subject, setting, style, lighting). Stable Diffusion cannot follow instructions: for an edit, describe how the edited picture must look ("a red sports car on a beach at sunset"), never the change ("make it red").'
                },
                negative_prompt: {
                    type: Type.STRING,
                    description: 'Optional, in English: things the picture must not contain'
                },
                source_image: {
                    type: Type.STRING,
                    description: 'Only to edit: "last" = the newest image in the conversation (the photo the user attached or a previous result). Omit to create a new image.'
                },
                strength: {
                    type: Type.NUMBER,
                    description: 'Only with source_image: how much to change it, 0.3-0.5 keeps the composition (recolor, light restyle), 0.6-0.8 for a strong transformation. Default 0.65'
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
        const result = await imageGenService.generateFromChat({ // the LLM leaves the RAM for SD, then comes back
            prompt: prompt.trim(),
            negativePrompt: (args.negative_prompt as string) || undefined,
            sourceImage: (args.source_image as string) || undefined,
            strength: typeof args.strength === 'number' ? args.strength : undefined
        });

        return {
            success: true,
            message: `Image ${args.source_image ? 'edited' : 'generated'} on the NPU in ${(result.generationTimeMs / 1000).toFixed(1)}s and shown to the user (prompt: "${prompt}").`,
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
    const durationSeconds = clampInt(args.duration_seconds, 1, 60, 10);
    // A file name only: no directories, no shell syntax (the path is passed to sh -c)
    const customFilename = typeof args.filename === 'string'
        ? args.filename.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '')
        : '';

    const filename = customFilename || `recording_${new Date().getTime()}.wav`;
    const targetDir = '/storage/emulated/0/Documents/AI_Companion_Audio';
    const targetFile = `${targetDir}/${filename}`;

    // Create directory and record
    const cmd = `mkdir -p ${targetDir} && termux-microphone-record -f ${shellQuote(targetFile)} -l ${durationSeconds}`;

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
