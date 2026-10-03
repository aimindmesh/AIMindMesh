/**
 * Maps clock instants to positions in the recorded file. Paused audio is not written to the file,
 * and Vosk timestamps count from its own start (earlier than the recorder's), so both need mapping
 * for tap-to-play, exports and speaker windows to point at the right audio.
 */
export class MeetingTimeline {
    private fileStart = 0;
    private voskStart: number | null = null;
    private pauses: Array<{ start: number; end: number | null }> = [];

    setFileStart(wall: number): void {
        this.fileStart = wall;
    }

    setVoskStart(wall: number): void {
        this.voskStart = wall;
    }

    pause(wall: number): void {
        if (!this.isPaused()) this.pauses.push({ start: wall, end: null });
    }

    resume(wall: number): void {
        const last = this.pauses[this.pauses.length - 1];
        if (last && last.end === null) last.end = Math.max(wall, last.start);
    }

    isPaused(): boolean {
        const last = this.pauses[this.pauses.length - 1];
        return !!last && last.end === null;
    }

    /** True when the instant falls inside a pause: speech from then must not reach the meeting. */
    isWallPaused(wall: number): boolean {
        return this.pauses.some(p => wall >= p.start && (p.end === null || wall < p.end));
    }

    /** Milliseconds of recorded audio before a wall-clock instant (paused time is not in the file). */
    wallToFileMs(wall: number): number {
        let ms = wall - this.fileStart;
        for (const p of this.pauses) {
            if (p.start >= wall) continue;
            const end = Math.min(p.end ?? wall, wall);
            ms -= Math.max(0, end - Math.max(p.start, this.fileStart));
        }
        return Math.max(0, Math.round(ms));
    }

    voskToWall(voskMs: number): number {
        return (this.voskStart ?? this.fileStart) + voskMs;
    }

    voskToFileMs(voskMs: number): number {
        return this.wallToFileMs(this.voskToWall(voskMs));
    }

    /**
     * Sample ranges [start, end) of a chunk captured outside pauses; the chunk ends at `endWall`.
     * Chunks arrive up to a few seconds late, so dropping whole chunks on pause lost speech said
     * just before pressing Pause.
     */
    keptSampleRanges(endWall: number, sampleCount: number, sampleRate: number): Array<[number, number]> {
        const msPerSample = 1000 / sampleRate;
        const startWall = endWall - sampleCount * msPerSample;
        let ranges: Array<[number, number]> = [[startWall, endWall]];
        for (const p of this.pauses) {
            const pauseEnd = p.end ?? Infinity;
            ranges = ranges.flatMap(([s, e]): Array<[number, number]> => {
                if (pauseEnd <= s || p.start >= e) return [[s, e]];
                const kept: Array<[number, number]> = [];
                if (p.start > s) kept.push([s, p.start]);
                if (pauseEnd < e) kept.push([pauseEnd, e]);
                return kept;
            });
        }
        return ranges
            .map(([s, e]): [number, number] => [
                Math.max(0, Math.round((s - startWall) / msPerSample)),
                Math.min(sampleCount, Math.round((e - startWall) / msPerSample))
            ])
            .filter(([a, b]) => b > a);
    }
}
