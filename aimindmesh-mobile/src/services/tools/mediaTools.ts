/**
 * Media Tool Implementations
 */

import { executeTermuxCommand } from '../termuxPlugin';
import { ToolResult } from './types';

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
