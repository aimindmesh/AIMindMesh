/** End-of-turn markers of the common GGUF chat templates */
export const DEFAULT_STOP_TOKENS = ['<|im_end|>', '<|eot_id|>', '</s>', '<end_of_turn>', '<|end_of_text|>', '<|eom_id|>'];

/**
 * Streamed text from the native layer, with stop markers removed. Text that could be the
 * beginning of a stop marker split across two chunks is held back until the next chunk
 * shows whether it is one, so a marker never reaches the UI.
 */
export class StopTokenBuffer {
    private buffer = '';
    private readonly stops: string[];

    constructor(extraStops: string[] = []) {
        this.stops = [...new Set([...extraStops, ...DEFAULT_STOP_TOKENS])].filter(s => s.length > 0);
    }

    /** Adds a chunk: returns the text safe to show and whether a stop marker was reached. */
    push(chunk: string): { text: string; stopped: boolean } {
        this.buffer += chunk;

        let stopAt = -1;
        for (const stop of this.stops) {
            const at = this.buffer.indexOf(stop);
            if (at !== -1 && (stopAt === -1 || at < stopAt)) stopAt = at;
        }
        if (stopAt !== -1) {
            const text = this.buffer.slice(0, stopAt);
            this.buffer = '';
            return { text, stopped: true };
        }

        const held = this.partialStopLength();
        const text = this.buffer.slice(0, this.buffer.length - held);
        this.buffer = this.buffer.slice(this.buffer.length - held);
        return { text, stopped: false };
    }

    /** Text still held back when the stream ends (it was not a stop marker after all). */
    flush(): string {
        const rest = this.buffer;
        this.buffer = '';
        return rest;
    }

    /** Length of the longest end of the buffer that is the start of a stop marker. */
    private partialStopLength(): number {
        let longest = 0;
        for (const stop of this.stops) {
            for (let k = Math.min(stop.length - 1, this.buffer.length); k > longest; k--) {
                if (this.buffer.endsWith(stop.slice(0, k))) {
                    longest = k;
                    break;
                }
            }
        }
        return longest;
    }
}
