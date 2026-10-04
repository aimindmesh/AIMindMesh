import type { MeetingAnalysis } from '../types/meeting';

export interface MeetingActionCandidate {
  type: 'directive' | 'idea' | 'roleProposal' | 'task';
  title: string;
  summary: string;
  confidence: number;
}

// Whole words: "focus" also matched "focused", "create" matched "creature"
const ACTION_PATTERN = /\b(should|need to|let's|create|build|focus)\b/i;
// Lines come in as "Speaker name: text"
const SPEAKER_PREFIX = /^[^:]{1,40}:\s+/;

export function extractMeetingCandidates(transcript: string): MeetingActionCandidate[] {
  const candidates: MeetingActionCandidate[] = [];
  const lines = transcript.split(/\n+/).map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (ACTION_PATTERN.test(line)) {
      const statement = line.replace(SPEAKER_PREFIX, '');
      candidates.push({
        type: 'directive',
        title: statement.slice(0, 80),
        summary: line,
        confidence: 0.6,
      });
    }
  }
  return candidates;
}

/**
 * Candidates from the AI notes of a meeting: its action items become tasks, its decisions
 * directives (much more reliable than the keyword match on the transcript).
 */
export function candidatesFromAnalysis(analysis: MeetingAnalysis | null | undefined): MeetingActionCandidate[] {
  if (!analysis || analysis.markdown) return [];
  return [
    ...analysis.actionItems.map(item => ({
      type: 'task' as const,
      title: item.task.slice(0, 80),
      summary: [item.task, item.owner && `Owner: ${item.owner}`, item.due && `Due: ${item.due}`].filter(Boolean).join('. '),
      confidence: 0.9,
    })),
    ...analysis.decisions.map(decision => ({
      type: 'directive' as const,
      title: decision.text.slice(0, 80),
      summary: decision.text,
      confidence: 0.85,
    })),
  ];
}
