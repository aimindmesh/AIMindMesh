import { FileSystemAdapter as Filesystem, Encoding } from '../../utils/fileSystemAdapter';
import * as pdfjsLib from 'pdfjs-dist';
import * as mammoth from 'mammoth';

// Fix for PDF.js worker
// @ts-ignore
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString();

export class DocumentParser {

    /**
     * Parse a file based on its extension
     */
    async parse(filePath: string, fileType: string): Promise<string> {
        const ext = fileType.toLowerCase().replace('.', '');

        switch (ext) {
            case 'pdf':
                return this.parsePDF(filePath);
            case 'docx':
                return this.parseDOCX(filePath);
            case 'md':
            case 'txt':
            case 'json':
            case 'js':
            case 'ts':
            case 'tsx':
                return this.parseTXT(filePath);
            default:
                throw new Error(`Unsupported file type: ${ext}`);
        }
    }

    /**
     * Parse Text files
     */
    private async parseTXT(filePath: string): Promise<string> {
        const contents = await Filesystem.readFile({
            path: filePath,
            encoding: Encoding.UTF8,
        });
        return contents.data as string;
    }

    /**
     * Parse PDF files using pdfjs-dist
     */
    private async parsePDF(filePath: string): Promise<string> {
        // Read file as base64
        const file = await Filesystem.readFile({
            path: filePath,
        });

        const data = atob(file.data as string);
        const loadingTask = pdfjsLib.getDocument({ data });
        const pdf = await loadingTask.promise;

        let fullText = '';

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items
                .map((item: any) => item.str)
                .join(' ');

            fullText += `\n--- Page ${i} ---\n${pageText}`;
        }

        return fullText;
    }

    /**
     * Parse DOCX files using mammoth
     */
    private async parseDOCX(filePath: string): Promise<string> {
        // Read file as base64
        const file = await Filesystem.readFile({
            path: filePath,
        });

        const buffer = Uint8Array.from(atob(file.data as string), c => c.charCodeAt(0));

        const result = await mammoth.extractRawText({ arrayBuffer: buffer.buffer });
        return result.value;
    }
}
