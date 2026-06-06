/**
 * Meeting Export Plugin Bridge
 * 
 * TypeScript bridge to the native MeetingExportPlugin for:
 *   - PDF generation (HTML → WebView → PrintDocumentAdapter)
 *   - File sharing (Android Share Intent via FileProvider)
 *   - Saving export files to app storage
 */

import { registerPlugin } from '@capacitor/core';
import { Capacitor } from '@capacitor/core';

interface MeetingExportNativePlugin {
    exportToPDF(opts: { html: string; title?: string }): Promise<void>;
    shareFile(opts: { filePath: string; mimeType?: string; title?: string }): Promise<void>;
    saveTextFile(opts: { content: string; filename: string }): Promise<{ filePath: string }>;
}

const MeetingExportNative = registerPlugin<MeetingExportNativePlugin>('MeetingExport');

export const meetingExportPlugin = {
    /**
     * Generate PDF from HTML content using Android's print framework.
     * Opens the system print dialog where user can save as PDF.
     */
    async exportToPDF(html: string, title?: string): Promise<void> {
        if (!Capacitor.isNativePlatform()) {
            // Fallback: open in new window for printing
            const win = window.open('', '_blank');
            if (win) {
                win.document.write(html);
                win.document.close();
                win.print();
            }
            return;
        }
        await MeetingExportNative.exportToPDF({ html, title });
    },

    /**
     * Share a file using Android Share Intent.
     */
    async shareFile(filePath: string, mimeType?: string, title?: string): Promise<void> {
        if (!Capacitor.isNativePlatform()) return;
        await MeetingExportNative.shareFile({ filePath, mimeType, title });
    },

    /**
     * Save text content to a file and return the absolute path.
     */
    async saveTextFile(content: string, filename: string): Promise<string> {
        if (!Capacitor.isNativePlatform()) {
            // Fallback: download via blob URL
            const blob = new Blob([content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
            return filename;
        }
        const { filePath } = await MeetingExportNative.saveTextFile({ content, filename });
        return filePath;
    },
};
