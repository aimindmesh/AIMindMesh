/**
 * Meeting Export Service
 *
 * Provides multi-format export for meeting transcripts:
 *   - Markdown (.md) — structured with speaker labels, timestamps, headers
 *   - SRT (.srt)     — SubRip subtitle format (numbered, timecoded)
 *   - VTT (.vtt)     — WebVTT subtitle format (speaker cues, timecoded)
 *
 * PDF export is handled natively by MeetingExportPlugin (WebView → PrintDocumentAdapter).
 */

import { AnalysisPoint, SavedMeeting } from '../../types/meeting';
import { formatClock } from '../llm/meetingPrompts';
import { displayTitle } from './meetingNotes';
import { anchorBookmarks } from './transcriptTimeline';
import { speakerLabel } from './speakerEdits';

export type ExportFormat = 'markdown' | 'pdf' | 'srt' | 'vtt';

export interface ExportOptions {
    includeSpeakerLabels: boolean;
    includeTimestamps: boolean;
    includeWordTimestamps: boolean;
    /** AI notes and marked moments, before the transcript (Markdown and PDF). */
    includeNotes: boolean;
}

const DEFAULT_OPTIONS: ExportOptions = {
    includeSpeakerLabels: true,
    includeTimestamps: true,
    includeWordTimestamps: false,
    includeNotes: true,
};

// ─── Time Formatting ─────────────────────────────────────

/**
 * Convert milliseconds to SRT time format: HH:MM:SS,mmm
 */
function msToSRTTime(ms: number): string {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1_000);
    const mmm = ms % 1_000;
    return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(mmm, 3)}`;
}

/**
 * Convert milliseconds to VTT time format: HH:MM:SS.mmm
 */
function msToVTTTime(ms: number): string {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1_000);
    const mmm = ms % 1_000;
    return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(mmm, 3)}`;
}

function pad(n: number, width: number): string {
    return n.toString().padStart(width, '0');
}

/**
 * Cue times. Segments without timing (start = end, e.g. old meetings) get a 3 s cue, otherwise
 * players never show them.
 */
function cueTimes(seg: { start_ms?: number; end_ms?: number }): { start: number; end: number } {
    const start = Math.max(0, Math.round(seg.start_ms ?? 0));
    const end = Math.round(seg.end_ms ?? 0);
    return { start, end: end > start ? end : start + 3000 };
}

/** Transcript and names are user text: unescaped they broke (or injected into) the PDF page */
function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getSpeakerName(speakerId: number, speakerNames: Record<number, string>): string {
    return speakerLabel(speakerId, speakerNames);
}

// ─── Export Formatters ───────────────────────────────────

/**
 * Export meeting transcript as Markdown
 */
export function toMarkdown(
    meeting: SavedMeeting,
    options: ExportOptions = DEFAULT_OPTIONS
): string {
    const lines: string[] = [];
    const date = new Date(meeting.timestamp);
    const time = (ms?: number) => (options.includeTimestamps && ms != null ? ` \`${formatClock(ms)}\`` : '');

    lines.push(`# ${displayTitle({ ...meeting, title: meeting.title ?? '', analysis: meeting.analysis ?? null })}`);
    lines.push(`**${'Date'}:** ${date.toLocaleDateString()} ${date.toLocaleTimeString()}  `);
    lines.push(`**${'Duration'}:** ${formatDuration(meeting.duration)}  `);
    lines.push(`**${'Speakers'}:** ${speakerList(meeting)}`);
    lines.push('');

    const analysis = options.includeNotes ? meeting.analysis : null;
    if (analysis?.markdown) {
        lines.push(`## ${'AI notes'}`, '', analysis.markdown, '');
    } else if (analysis) {
        if (analysis.summary) lines.push(`## ${'Summary'}`, '', analysis.summary, '');
        const points = (title: string, list: AnalysisPoint[]) => {
            if (list.length === 0) return;
            lines.push(`## ${title}`, '', ...list.map(p => `- ${p.text}${time(p.atMs)}`), '');
        };
        points('Key points', analysis.keyPoints);
        points('Decisions', analysis.decisions);
        if (analysis.actionItems.length > 0) {
            lines.push(`## ${'Action items'}`, '');
            for (const a of analysis.actionItems) {
                const who = [a.owner, a.due].filter(Boolean).join(', ');
                lines.push(`- [ ] ${a.task}${who ? ` (${who})` : ''}${time(a.atMs)}`);
            }
            lines.push('');
        }
        points('Open questions', analysis.openQuestions);
    }

    if (options.includeNotes && (meeting.bookmarks ?? []).length > 0) {
        const anchors = anchorBookmarks(meeting.transcript, meeting.bookmarks ?? []);
        lines.push(`## ${'Marked moments'}`, '');
        for (const [index, bookmarks] of anchors) {
            for (const b of bookmarks) {
                const said = index >= 0 ? ` — ${meeting.transcript[index].text}` : '';
                lines.push(`- \`${formatClock(b.ms)}\`${b.note ? ` ${b.note}` : ''}${said}`);
            }
        }
        lines.push('');
    }

    lines.push(`## ${'Transcript'}`);
    lines.push('');

    for (const seg of meeting.transcript) {
        const name = options.includeSpeakerLabels
            ? `**${getSpeakerName(seg.speakerId, meeting.speakerNames)}**`
            : '';

        const stamp = options.includeTimestamps && seg.start_ms != null
            ? `\`${formatClock(seg.start_ms)}\``
            : '';

        const prefix = [stamp, name].filter(Boolean).join(' ');
        lines.push(prefix ? `${prefix}: ${seg.text}` : seg.text);
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * Export meeting transcript as SRT (SubRip Subtitle)
 */
export function toSRT(
    meeting: SavedMeeting,
    options: ExportOptions = DEFAULT_OPTIONS
): string {
    const lines: string[] = [];

    meeting.transcript.forEach((seg, idx) => {
        const { start, end } = cueTimes(seg);

        lines.push(`${idx + 1}`);
        lines.push(`${msToSRTTime(start)} --> ${msToSRTTime(end)}`);

        const name = options.includeSpeakerLabels
            ? `${getSpeakerName(seg.speakerId, meeting.speakerNames)}: `
            : '';

        lines.push(`${name}${seg.text}`);
        lines.push('');
    });

    return lines.join('\n');
}

/**
 * Export meeting transcript as WebVTT
 */
export function toVTT(
    meeting: SavedMeeting,
    options: ExportOptions = DEFAULT_OPTIONS
): string {
    const lines: string[] = ['WEBVTT', ''];

    meeting.transcript.forEach((seg, idx) => {
        const { start, end } = cueTimes(seg);

        const name = options.includeSpeakerLabels
            ? getSpeakerName(seg.speakerId, meeting.speakerNames).replace(/[<>\r\n]/g, ' ')
            : undefined;

        // VTT supports voice spans: <v Speaker>text</v>
        lines.push(`${idx + 1}`);
        lines.push(`${msToVTTTime(start)} --> ${msToVTTTime(end)}`);
        lines.push(name ? `<v ${name}>${seg.text}</v>` : seg.text);
        lines.push('');
    });

    return lines.join('\n');
}

/**
 * Generate HTML content for PDF rendering (sent to native plugin)
 */
export function toHTMLForPDF(
    meeting: SavedMeeting,
    options: ExportOptions = DEFAULT_OPTIONS
): string {
    const date = new Date(meeting.timestamp);

    let html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body { font-family: 'Inter', sans-serif; margin: 2cm; color: #222; line-height: 1.6; }
  h1 { color: #333; border-bottom: 2px solid #7c3aed; padding-bottom: 8px; }
  .meta { color: #666; margin-bottom: 16px; }
  .segment { margin-bottom: 12px; }
  .speaker { font-weight: 600; color: #7c3aed; }
  .time { color: #999; font-size: 0.85em; font-family: monospace; }
  h2 { color: #333; font-size: 1.15em; margin-top: 20px; }
  ul { padding-left: 20px; } ul.tasks { list-style: none; padding-left: 0; }
  .notes { white-space: pre-wrap; }
  hr { border: none; border-top: 1px solid #eee; margin: 16px 0; }
</style></head><body>`;

    const time = (ms?: number) => (options.includeTimestamps && ms != null ? ` <span class="time">${formatClock(ms)}</span>` : '');

    html += `<h1>${escapeHtml(displayTitle({ ...meeting, title: meeting.title ?? '', analysis: meeting.analysis ?? null }))}</h1>`;
    html += `<div class="meta">`;
    html += `<strong>${'Date'}:</strong> ${date.toLocaleDateString()} ${date.toLocaleTimeString()}<br>`;
    html += `<strong>${'Duration'}:</strong> ${formatDuration(meeting.duration)}<br>`;
    html += `<strong>${'Speakers'}:</strong> ${escapeHtml(speakerList(meeting))}`;
    html += `</div><hr>`;

    const analysis = options.includeNotes ? meeting.analysis : null;
    if (analysis?.markdown) {
        html += `<h2>${'AI notes'}</h2><div class="notes">${escapeHtml(analysis.markdown)}</div>`;
    } else if (analysis) {
        if (analysis.summary) html += `<h2>${'Summary'}</h2><p>${escapeHtml(analysis.summary)}</p>`;
        const points = (title: string, list: AnalysisPoint[]) => {
            if (list.length === 0) return;
            html += `<h2>${title}</h2><ul>${list.map(p => `<li>${escapeHtml(p.text)}${time(p.atMs)}</li>`).join('')}</ul>`;
        };
        points('Key points', analysis.keyPoints);
        points('Decisions', analysis.decisions);
        if (analysis.actionItems.length > 0) {
            html += `<h2>${'Action items'}</h2><ul class="tasks">`;
            for (const a of analysis.actionItems) {
                const who = [a.owner, a.due].filter(Boolean).join(', ');
                html += `<li>&#9744; ${escapeHtml(a.task)}${who ? ` <em>(${escapeHtml(who)})</em>` : ''}${time(a.atMs)}</li>`;
            }
            html += `</ul>`;
        }
        points('Open questions', analysis.openQuestions);
    }
    if (options.includeNotes && (meeting.bookmarks ?? []).length > 0) {
        const anchors = anchorBookmarks(meeting.transcript, meeting.bookmarks ?? []);
        html += `<h2>${'Marked moments'}</h2><ul>`;
        for (const [index, bookmarks] of anchors) {
            for (const b of bookmarks) {
                const said = index >= 0 ? ` — ${escapeHtml(meeting.transcript[index].text)}` : '';
                html += `<li><span class="time">${formatClock(b.ms)}</span>${b.note ? ` ${escapeHtml(b.note)}` : ''}${said}</li>`;
            }
        }
        html += `</ul>`;
    }
    if (analysis || (options.includeNotes && (meeting.bookmarks ?? []).length > 0)) {
        html += `<h2>${'Transcript'}</h2>`;
    }

    for (const seg of meeting.transcript) {
        html += `<div class="segment">`;
        if (options.includeTimestamps && seg.start_ms != null) {
            html += `<span class="time">${formatClock(seg.start_ms)}</span> `;
        }
        if (options.includeSpeakerLabels) {
            html += `<span class="speaker">${escapeHtml(getSpeakerName(seg.speakerId, meeting.speakerNames))}:</span> `;
        }
        html += escapeHtml(seg.text);
        html += `</div>`;
    }

    html += `</body></html>`;
    return html;
}

// ─── Helpers ─────────────────────────────────────────────

/** Everyone who speaks, by name when renamed, in order of first appearance. */
function speakerList(meeting: SavedMeeting): string {
    const ids = [...new Set(meeting.transcript.map(t => t.speakerId))];
    return ids.map(id => getSpeakerName(id, meeting.speakerNames)).join(', ') || 'Unknown';
}

/** @param seconds meeting duration as stored (seconds) */
function formatDuration(seconds: number): string {
    const totalSec = Math.floor(seconds);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

/**
 * Main export dispatcher
 */
export async function exportMeetingAs(
    meeting: SavedMeeting,
    format: ExportFormat,
    options: Partial<ExportOptions> = {}
): Promise<{ content: string; mimeType: string; extension: string }> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    switch (format) {
        case 'markdown':
            return { content: toMarkdown(meeting, opts), mimeType: 'text/markdown', extension: 'md' };
        case 'srt':
            return { content: toSRT(meeting, opts), mimeType: 'application/x-subrip', extension: 'srt' };
        case 'vtt':
            return { content: toVTT(meeting, opts), mimeType: 'text/vtt', extension: 'vtt' };
        case 'pdf':
            return { content: toHTMLForPDF(meeting, opts), mimeType: 'text/html', extension: 'html' };
        default:
            throw new Error(`Unsupported export format: ${format}`);
    }
}
