import { TranscriptSegment } from '../../types/meeting';

/**
 * Applies temporal smoothing (HMM Viterbi or Median filter) to transcript speaker assignments
 */
export function applyTemporalSmoothing(
    segments: TranscriptSegment[],
    algorithm: 'hmm' | 'median' | string = 'median'
): TranscriptSegment[] {
    if (segments.length === 0) return segments;

    if (algorithm === 'hmm') {
        const uniqueSpeakersSet = new Set(segments.map(s => s.speakerId));
        const states = Array.from(uniqueSpeakersSet);
        const nStates = states.length;

        if (nStates <= 1) return [...segments];

        const T = segments.length;
        const pStay = 0.95;
        const pSwitch = (1.0 - pStay) / (nStates - 1);
        const pCorrectObs = 0.85;
        const pWrongObs = (1.0 - pCorrectObs) / (nStates - 1);

        const viterbi: number[][] = Array(T).fill(0).map(() => Array(nStates).fill(0));
        const backpointer: number[][] = Array(T).fill(0).map(() => Array(nStates).fill(0));

        // Initialization (t = 0)
        const obs0 = segments[0].speakerId;
        for (let s = 0; s < nStates; s++) {
            const initialProb = 1.0 / nStates;
            const emissionProb = states[s] === obs0 ? pCorrectObs : pWrongObs;
            viterbi[0][s] = Math.log(initialProb) + Math.log(emissionProb);
            backpointer[0][s] = 0;
        }

        // Recursion (t = 1 to T-1)
        for (let t = 1; t < T; t++) {
            const obs = segments[t].speakerId;
            for (let s = 0; s < nStates; s++) {
                let maxLogProb = -Infinity;
                let bestPrevState = 0;
                const emissionProb = states[s] === obs ? pCorrectObs : pWrongObs;

                for (let prevS = 0; prevS < nStates; prevS++) {
                    const transProb = states[prevS] === states[s] ? pStay : pSwitch;
                    const prob = viterbi[t - 1][prevS] + Math.log(transProb);
                    if (prob > maxLogProb) {
                        maxLogProb = prob;
                        bestPrevState = prevS;
                    }
                }

                viterbi[t][s] = maxLogProb + Math.log(emissionProb);
                backpointer[t][s] = bestPrevState;
            }
        }

        // Termination
        let bestLastState = 0;
        let maxFinalProb = -Infinity;
        for (let s = 0; s < nStates; s++) {
            if (viterbi[T - 1][s] > maxFinalProb) {
                maxFinalProb = viterbi[T - 1][s];
                bestLastState = s;
            }
        }

        // Path backtracking
        const bestPath = new Array(T);
        bestPath[T - 1] = bestLastState;
        for (let t = T - 1; t > 0; t--) {
            bestPath[t - 1] = backpointer[t][bestPath[t]];
        }

        return segments.map((seg, t) => ({
            ...seg,
            speakerId: states[bestPath[t]]
        }));
    }

    // Median filter
    const MEDIAN_WINDOW = 5;
    if (segments.length < MEDIAN_WINDOW) return [...segments];

    const halfW = Math.floor(MEDIAN_WINDOW / 2);
    return segments.map((seg, idx) => {
        const start = Math.max(0, idx - halfW);
        const end = Math.min(segments.length - 1, idx + halfW);
        const windowIds = segments.slice(start, end + 1).map(s => s.speakerId);

        const freq = new Map<number, number>();
        for (const id of windowIds) {
            freq.set(id, (freq.get(id) ?? 0) + 1);
        }
        let modeId = seg.speakerId;
        let maxFreq = 0;
        for (const [id, count] of freq) {
            if (count > maxFreq) {
                maxFreq = count;
                modeId = id;
            }
        }
        return { ...seg, speakerId: modeId };
    });
}
