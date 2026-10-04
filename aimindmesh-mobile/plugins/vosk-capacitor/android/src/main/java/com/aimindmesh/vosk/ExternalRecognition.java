package com.aimindmesh.vosk;

import android.util.Log;

import org.vosk.Recognizer;

/**
 * Live recognition on audio pushed by the app's meeting recorder through {@link VoskAudioBridge},
 * instead of the microphone. Word timestamps are reported in milliseconds from the start of the
 * recording that feeds the bridge, so they match the saved file.
 *
 * All access to the recognizer is guarded by {@code lock}, so stop never closes it while
 * acceptWaveForm is running on the recorder's thread.
 */
final class ExternalRecognition {
    private static final String TAG = "VoskExternal";
    private static final long SAMPLE_RATE = 16000L;

    private final Object lock = new Object();
    private Recognizer recognizer;
    private VoskAudioBridge.Sink sink;
    private VoskRecognizer.OnFinalResultListener onFinal;
    private long baseOffset = -1; // recording sample index of the first fed sample
    private String lastPartial = "";

    boolean isActive() {
        synchronized (lock) {
            return recognizer != null;
        }
    }

    /** Takes ownership of {@code newRecognizer} (closed by {@link #stop}). */
    void start(Recognizer newRecognizer,
               VoskRecognizer.OnPartialResultListener onPartial,
               VoskRecognizer.OnFinalResultListener onFinalResult) {
        stop();
        synchronized (lock) {
            newRecognizer.setWords(true);
            recognizer = newRecognizer;
            onFinal = onFinalResult;
            baseOffset = -1;
            lastPartial = "";
            sink = (samples, length, sampleOffset) ->
                    accept(newRecognizer, samples, length, sampleOffset, onPartial, onFinalResult);
            VoskAudioBridge.setSink(sink);
        }
        Log.i(TAG, "External-audio recognition started");
    }

    private void accept(Recognizer target, short[] samples, int length, long sampleOffset,
                        VoskRecognizer.OnPartialResultListener onPartial,
                        VoskRecognizer.OnFinalResultListener onFinalResult) {
        synchronized (lock) {
            if (recognizer != target) {
                return; // stopped or replaced meanwhile
            }
            if (baseOffset < 0) {
                baseOffset = sampleOffset;
            }
            if (target.acceptWaveForm(samples, length)) {
                emitFinal(target.getResult(), onFinalResult);
                lastPartial = "";
            } else {
                String text = VoskRecognizer.parseHypothesis(target.getPartialResult());
                if (onPartial != null && !text.isEmpty() && !text.equals(lastPartial)) {
                    lastPartial = text;
                    onPartial.onResult(text);
                }
            }
        }
    }

    private void emitFinal(String result, VoskRecognizer.OnFinalResultListener listener) {
        String text = VoskRecognizer.parseHypothesis(result);
        if (listener == null || text.isEmpty()) {
            return;
        }
        long[] boundaries = VoskRecognizer.parseBoundaries(result);
        long baseMs = Math.max(0, baseOffset) * 1000L / SAMPLE_RATE;
        listener.onResult(text, VoskRecognizer.parseSpeakerVector(result), boundaries[0] + baseMs, boundaries[1] + baseMs);
    }

    /** Flushes the last utterance and releases the recognizer. */
    void stop() {
        synchronized (lock) {
            if (recognizer == null) {
                return;
            }
            VoskAudioBridge.clearSink(sink);
            try {
                emitFinal(recognizer.getFinalResult(), onFinal);
            } catch (Exception e) {
                Log.w(TAG, "Failed to flush final external result", e);
            }
            recognizer.close();
            recognizer = null;
            sink = null;
            onFinal = null;
            Log.i(TAG, "External-audio recognition stopped");
        }
    }
}
