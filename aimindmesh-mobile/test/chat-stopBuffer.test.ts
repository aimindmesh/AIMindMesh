import { describe, expect, it } from 'vitest';
import { StopTokenBuffer } from '../src/services/llm/nativeStopBuffer';

const feed = (buffer: StopTokenBuffer, chunks: string[]) => {
  let text = '';
  let stopped = false;
  for (const chunk of chunks) {
    const out = buffer.push(chunk);
    text += out.text;
    if (out.stopped) { stopped = true; break; }
  }
  if (!stopped) text += buffer.flush();
  return { text, stopped };
};

describe('native stop token buffer', () => {
  it('passes plain text through immediately', () => {
    const b = new StopTokenBuffer();
    expect(b.push('Hello world')).toEqual({ text: 'Hello world', stopped: false });
  });

  it('stops on a marker split across chunks without showing any part of it', () => {
    expect(feed(new StopTokenBuffer(), ['Answer done<|im', '_end|>more'])).toEqual({ text: 'Answer done', stopped: true });
    expect(feed(new StopTokenBuffer(), ['Hi <end_of', '_turn>'])).toEqual({ text: 'Hi ', stopped: true });
  });

  it('holds back only the possible marker start, then releases it when it is not one', () => {
    const b = new StopTokenBuffer();
    expect(b.push('a < b')).toEqual({ text: 'a < b', stopped: false });
    expect(b.push(' x <')).toEqual({ text: ' x ', stopped: false });
    expect(b.push('div>')).toEqual({ text: '<div>', stopped: false });
  });

  it('uses caller stop sequences and keeps held text at the end of the stream', () => {
    expect(feed(new StopTokenBuffer(['STOP']), ['abc ST', 'OP tail'])).toEqual({ text: 'abc ', stopped: true });
    expect(feed(new StopTokenBuffer(), ['ends with <|'])).toEqual({ text: 'ends with <|', stopped: false });
  });
});
