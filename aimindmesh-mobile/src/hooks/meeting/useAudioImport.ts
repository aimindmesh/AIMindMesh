import React, { useRef, useState, useCallback } from 'react';
import AudioConverter from '../../services/audio/audioConverter';
import { FileSystemAdapter, Directory } from '../../utils/fileSystemAdapter';
import { logger } from '../../services/logger';
import { Filesystem } from '@capacitor/filesystem';

export interface ImportedAudio {
    meetingId: string;
    /** Absolute path of files/meeting-audio/{meetingId}.audio */
    audioPath: string;
    mimeType: string;
    durationSec: number;
    startedAt: number;
}

interface UseAudioImportProps {
    /** Opens the imported audio as the current meeting (which the autosave then stores). */
    onImported: (imported: ImportedAudio) => Promise<void> | void;
    showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export interface AudioImportState {
    fileInputRef: React.RefObject<HTMLInputElement>;
    isImporting: boolean;
    triggerAudioImport: () => void;
    handleFileSelected: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
}

export function useAudioImport({
    onImported,
    showToast
}: UseAudioImportProps): AudioImportState {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isImporting, setIsImporting] = useState(false);

    const triggerAudioImport = useCallback(() => {
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
            fileInputRef.current.click();
        }
    }, []);

    const handleFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        const file = files[0];
        setIsImporting(true);
        showToast(`Importing ${file.name}...`, 'info');

        const newMeetingId = `imported_${Date.now()}`;
        const tempExt = file.name.includes('.') ? file.name.substring(file.name.lastIndexOf('.')) : '.m4a';
        const tempFileName = `import_cache_${Date.now()}${tempExt}`;

        try {
            // Read file into Base64
            const base64Data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const result = reader.result as string;
                    const commaIdx = result.indexOf(',');
                    resolve(commaIdx >= 0 ? result.substring(commaIdx + 1) : result);
                };
                reader.onerror = () => reject(new Error('Failed to read audio file'));
                reader.readAsDataURL(file);
            });

            // Write temporary audio file to app Cache directory
            await FileSystemAdapter.writeFile({
                path: tempFileName,
                data: base64Data,
                directory: Directory.Cache
            });

            const tempUriResult = await FileSystemAdapter.getUri({
                path: tempFileName,
                directory: Directory.Cache
            });

            const nativeTempPath = tempUriResult.uri.replace('file://', '');

            // Decode to 16kHz Mono WAV & create companion .m4a audio file
            logger.log('info', `Decoding imported audio file: ${nativeTempPath}`);
            const result = await AudioConverter.decodeAudioFile({
                filePath: nativeTempPath,
                meetingId: newMeetingId
            });

            const durationSec = Math.max(1, Math.round(result.durationMs / 1000));
            // The WAV is only for transcription: the post-processing decodes the meeting audio itself
            Filesystem.deleteFile({ path: `file://${result.wavPath}` }).catch(() => { });
            if (!result.m4aPath) throw new Error('the audio could not be converted');

            // Clean up temporary cache file
            FileSystemAdapter.deleteFile({
                path: tempFileName,
                directory: Directory.Cache
            }).catch(() => { });

            await onImported({
                meetingId: newMeetingId,
                audioPath: result.m4aPath,
                mimeType: 'audio/mp4',
                durationSec,
                startedAt: Date.now()
            });

            showToast(`Audio imported (${file.name}): tap "Transcribe (Whisper)" to transcribe it`, 'success');
        } catch (error) {
            logger.log('error', 'Audio import failed', error);
            showToast(`Import failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
        } finally {
            setIsImporting(false);
            if (e.target) {
                e.target.value = '';
            }
        }
    }, [onImported, showToast]);

    return {
        fileInputRef,
        isImporting,
        triggerAudioImport,
        handleFileSelected
    };
}
