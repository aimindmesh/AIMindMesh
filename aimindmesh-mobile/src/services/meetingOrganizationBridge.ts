export interface MeetingActionCandidate {
  type: 'directive' | 'idea' | 'roleProposal' | 'task';
  title: string;
  summary: string;
  confidence: number;
}

export function extractMeetingCandidates(transcript: string): MeetingActionCandidate[] {
  const candidates: MeetingActionCandidate[] = [];
  const lines = transcript.split(/\n+/).map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (/should|need to|let's|create|build|focus/i.test(line)) {
      candidates.push({
        type: 'directive',
        title: line.slice(0, 80),
        summary: line,
        confidence: 0.6,
      });
    }
  }
  return candidates;
}
