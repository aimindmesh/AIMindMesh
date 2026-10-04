import { describe, expect, it } from 'vitest';
import {
  PUSH_MEETINGS_QUERY,
  PUSH_SEGMENTS_QUERY,
  pulledMeetingStatement,
  pulledSegmentStatement
} from '../src/services/sync/meetingSyncRows';

const placeholders = (sql: string) => (sql.match(/\?/g) || []).length;
const meeting = { id: 'm1', timestamp: 1, duration: 60, has_audio: 1, speaker_names_json: '{}' };

describe('meeting rows sent to the server', () => {
  it('include the notes but never the voices or the search index', () => {
    expect(PUSH_MEETINGS_QUERY).toMatch(/title, bookmarks_json, analysis_json, questions_json/);
    expect(PUSH_MEETINGS_QUERY).not.toMatch(/voices_json|SELECT \*/);
    expect(PUSH_SEGMENTS_QUERY).not.toMatch(/search_text|SELECT \*/);
  });
});

describe('meeting rows pulled from the server', () => {
  it('write the notes the server sent, and only those', () => {
    const { statement, values } = pulledMeetingStatement({ ...meeting, title: 'Budget', analysis_json: null } as any);
    expect(values).toHaveLength(placeholders(statement));
    // value columns then "sent" flags, in the order title, bookmarks, analysis, questions
    expect(values.slice(-8)).toEqual(['Budget', null, null, null, 1, 0, 1, 0]);
    expect(statement).toContain('title = CASE WHEN ? THEN excluded.title ELSE meetings.title END');
    expect(statement).toContain('WHERE meetings.is_synced = 1');
  });

  it('an older server without notes leaves the local notes alone', () => {
    const { values } = pulledMeetingStatement(meeting as any);
    expect(values.slice(-4)).toEqual([0, 0, 0, 0]);
  });

  it('segments get their search index computed here', () => {
    const { statement, values } = pulledSegmentStatement({ id: 's1', meeting_id: 'm1', sequence: 0, start_ms: 0, end_ms: 9, text: 'Città VECCHIA' });
    expect(values).toHaveLength(placeholders(statement));
    expect(values).toContain('citta vecchia');
  });
});
