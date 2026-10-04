package com.aimindmesh.whisper;

import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;

import java.util.concurrent.ExecutorService;

/**
 * Whisper.transcribeRange: transcribes [startMs, endMs) of a 16 kHz mono WAV file. Only that
 * range is read, so long meetings are processed chunk by chunk with bounded memory, progress
 * and cancellation. Segment times are relative to the start of the file.
 */
final class WhisperRangeCall {
    private static final String TAG = "WhisperPlugin";

    private WhisperRangeCall() {
    }

    static void run(PluginCall call, WhisperContext context, ExecutorService executor) {
        if (context == null) {
            call.reject("Model not loaded. Call loadModel first.");
            return;
        }
        String audioPath = call.getString("audioPath");
        Double startMs = call.getDouble("startMs");
        Double endMs = call.getDouble("endMs");
        if (audioPath == null || startMs == null || endMs == null) {
            call.reject("audioPath, startMs and endMs are required");
            return;
        }
        String language = call.getString("language", "auto");
        int threads = call.getInt("threads", 4);
        int beamSize = call.getInt("beamSize", 1);
        String initialPrompt = call.getString("initialPrompt", "");
        int audioCtx = call.getInt("audioCtx", 0);

        executor.execute(() -> {
            try {
                long t0 = System.currentTimeMillis();
                WhisperContext.TranscriptResult result = context.transcribeFileRange(
                        audioPath, startMs.longValue(), endMs.longValue(), language, threads, beamSize, initialPrompt, audioCtx);
                long elapsed = System.currentTimeMillis() - t0;
                Log.i(TAG, "transcribeRange " + (long) (endMs - startMs) + " ms of audio in " + elapsed + " ms");

                JSObject response = new JSObject();
                response.put("text", result.text);
                response.put("language", result.language);
                response.put("processingTimeMs", elapsed);
                JSArray segments = new JSArray();
                for (WhisperContext.Segment seg : result.segments) {
                    JSObject segObj = new JSObject();
                    segObj.put("text", seg.text);
                    segObj.put("startMs", seg.startMs);
                    segObj.put("endMs", seg.endMs);
                    segments.put(segObj);
                }
                response.put("segments", segments);
                call.resolve(response);
            } catch (Exception e) {
                Log.e(TAG, "transcribeRange failed", e);
                call.reject("Transcription failed: " + e.getMessage());
            }
        });
    }
}
