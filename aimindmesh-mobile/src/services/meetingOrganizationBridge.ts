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
