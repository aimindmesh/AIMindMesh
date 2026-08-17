import { useEffect, useRef } from 'react';
import { TranscriptSegment } from '../../types/meeting';
import { logger } from '../../services/logger';

interface UseOverlapDetectionProps {
    transcript: TranscriptSegment[];
    setTranscript: React.Dispatch<React.SetStateAction<TranscriptSegment[]>>;
}

/**
 * Detects temporal overlaps between segments from different speakers
 * and marks them with overlap: true for UI display.
 */
export function useOverlapDetection({ transcript, setTranscript }: UseOverlapDetectionProps) {
    const processedCountRef = useRef(0);

    useEffect(() => {
        if (transcript.length < 2) return;

        const newFrom = processedCountRef.current;
        if (newFrom >= transcript.length) return;

        const overlapIds = new Set<string>();
        const sorted = [...transcript].sort((a, b) => (a.start_ms || 0) - (b.start_ms || 0));

        for (let i = 0; i < sorted.length; i++) {
            const a = sorted[i];
            if (!a.start_ms || !a.end_ms) continue;
            for (let j = i + 1; j < sorted.length; j++) {
                const b = sorted[j];
                if (!b.start_ms || !b.end_ms) continue;
                // No more overlaps possible
                if (b.start_ms >= a.end_ms) break;
                // Skip same speaker
                if (a.speakerId === b.speakerId) continue;
                const overlapDuration = Math.min(a.end_ms, b.end_ms) - Math.max(a.start_ms, b.start_ms);
                // Only mark if overlap > 500ms (simultaneous, not just turn-taking)
                if (overlapDuration > 500) {
                    overlapIds.add(a.id);
                    overlapIds.add(b.id);
                }
            }
        }

        if (overlapIds.size > 0) {
            setTranscript(prev => prev.map(seg =>
                overlapIds.has(seg.id) ? { ...seg, overlap: true } : seg
            ));
            logger.log('debug', `Overlap detected: ${overlapIds.size} segments with simultaneous speech`);
        }

        processedCountRef.current = transcript.length;
    }, [transcript]);
}