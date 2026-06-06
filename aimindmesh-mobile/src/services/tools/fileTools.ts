import { Type } from '@google/genai';
import { ToolDefinition, ToolResult } from './types';
import { FileSystemAdapter as Filesystem, Directory, Encoding } from '../../utils/fileSystemAdapter';
import { FilePicker } from '@capawesome/capacitor-file-picker';

export const fileTools: ToolDefinition[] = [
    {
        name: 'download_file',
        description: 'Downloads a file from a URL to the device storage. Use this only when you have a direct URL to a file (e.g., found via search_web). Requires user confirmation.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                url: {
                    type: Type.STRING,
                    description: 'The direct URL of the file to download'
                },
                filename: {
                    type: Type.STRING,
                    description: 'The name to save the file as (e.g., "model.gguf", "document.pdf")'
                }
            },
            required: ['url', 'filename']
        },
        requiresConfirmation: true,
        category: 'files'
    },
    {
        name: 'search_files',
        description: 'Opens a file picker to search and select files or images from the device.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                file_type: {
                    type: Type.STRING,
                    description: 'Type of files to search for',
                    enum: ['images', 'documents', 'all']
                },
                multiple: {
                    type: Type.BOOLEAN,
                    description: 'Whether to allow selecting multiple files. Default is false.'
                }
            },
            required: ['file_type']
        },
        requiresConfirmation: false,
        category: 'files'
    },
    {
        name: 'create_text_file',
        description: 'Creates a new text file with the specified content.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                filename: {
                    type: Type.STRING,
                    description: 'Name of the file (e.g., "note.txt")'
                },
                content: {
                    type: Type.STRING,
                    description: 'Text content to write into the file'
                }
            },
            required: ['filename', 'content']
        },
        requiresConfirmation: true,
        category: 'files'
    },
    {
        name: 'take_photo', // Defined here but reused in mediaTools maybe?
        description: 'Takes a photo using the device camera.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                camera_facing: {
                    type: Type.STRING,
                    description: 'Which camera to use: "back" or "front". Default is "back".',
                    enum: ['back', 'front']
                }
            },
            required: []
        },
        requiresConfirmation: true,
        category: 'files'
    },
    {
        name: 'record_audio',
        description: 'Records audio from the device microphone.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                duration_seconds: {
                    type: Type.NUMBER,
                    description: 'Recording duration in seconds (default: 10, max: 60)'
                },
                filename: {
                    type: Type.STRING,
                    description: 'Optional: Custom filename for the recording'
                }
            },
            required: []
        },
        requiresConfirmation: true,
        category: 'files'
    }
];

export async function executeDownloadFile(args: { url: string; filename: string }): Promise<ToolResult> {
    try {
        const response = await fetch(args.url);
        const blob = await response.blob();
        const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
        });
        const data = base64.split(',')[1];

        await Filesystem.writeFile({
            path: args.filename,
            data: data,
            directory: Directory.Documents
        });
        return { success: true, message: `File downloaded to Documents/${args.filename}` };
    } catch (e: any) {
        return { success: false, message: "Download failed: " + e.message };
    }
}

export async function executeSearchFiles(args: { file_type: string; multiple?: boolean }): Promise<ToolResult> {
    try {
        const result = await FilePicker.pickFiles({
            multiple: args.multiple ?? false,
            readData: false
        } as any); // Cast to any to avoid type check issues if definition is outdated
        return { success: true, message: `Selected ${result.files.length} files`, data: result.files };
    } catch (e: any) {
        return { success: false, message: "File selection failed: " + e.message };
    }
}

export async function executeCreateTextFile(args: { filename: string; content: string }): Promise<ToolResult> {
    try {
        await Filesystem.writeFile({
            path: args.filename,
            data: args.content,
            directory: Directory.Documents,
            encoding: Encoding.UTF8
        });
        return { success: true, message: `File created at Documents/${args.filename}` };
    } catch (e: any) {
        return { success: false, message: "Failed to write file: " + e.message };
    }
}
