/*
 * LlamaCppInference.java - High-performance LLM inference wrapper
 * 
 * Provides native llama.cpp integration for GGUF models, including:
 * - Optimal native library for the CPU (NativeLibrarySelector)
 * - Token-by-token streaming
 * - Proper chat history management
 * - Performance metrics
 */

package com.aimindmesh.llama;

import android.util.Log;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

public class LlamaCppInference {
    private static final String TAG = "LlamaCppInference";
    // close() waits this long for a running generation before handing the free to native
    private static final long CLOSE_WAIT_MS = 10_000L;
    private volatile long nativePtr = 0L;
    private final AtomicBoolean isGenerating = new AtomicBoolean(false);
    private volatile boolean interruptRequested = false;
    private volatile Thread generationThread;
    private boolean isMultimodal = false;

    /** Optional per-request generation options; defaults keep the load-time behaviour. */
    public static class GenerationOptions {
        public int nPredict = 0;          // <= 0: no limit
        public float temperature = -1f;   // < 0: load-time temperature
        public float topP = -1f;          // <= 0: load-time top_p
        public String[] stop = new String[0];
    }

    // Inference parameters for model initialization
    public static class InferenceParams {
        public float minP = 0.1f;
        public float temperature = 0.8f;
        public boolean storeChats = true;
        public int contextSize = 2048;
        public String chatTemplate = null;
        public int numThreads = 4;
        public boolean useMmap = true;
        public boolean useMlock = false;
        public boolean useVulkan = false;
        public boolean useOpenCL = false;
        public boolean useHexagon = false;
        // New params matching PocketPal's ContextInitParams
        public int nBatch = 512;
        public int nUBatch = 512;
        public boolean flashAttn = false;
        public String cacheTypeK = "f16";
        public String cacheTypeV = "f16";
        public int nGpuLayers = 0;

        public InferenceParams() {
        }

        public InferenceParams withMinP(float minP) {
            this.minP = minP;
            return this;
        }

        public InferenceParams withTemperature(float temp) {
            this.temperature = temp;
            return this;
        }

        public InferenceParams withStoreChats(boolean store) {
            this.storeChats = store;
            return this;
        }

        public InferenceParams withContextSize(int size) {
            this.contextSize = size;
            return this;
        }

        public InferenceParams withChatTemplate(String template) {
            this.chatTemplate = template;
            return this;
        }

        public InferenceParams withNumThreads(int threads) {
            this.numThreads = threads;
            return this;
        }

        public InferenceParams withMmap(boolean mmap) {
            this.useMmap = mmap;
            return this;
        }

        public InferenceParams withMlock(boolean mlock) {
            this.useMlock = mlock;
            return this;
        }

        public InferenceParams withVulkan(boolean vulkan) {
            this.useVulkan = vulkan;
            return this;
        }

        public InferenceParams withOpenCL(boolean openCL) {
            this.useOpenCL = openCL;
            return this;
        }

        public InferenceParams withHexagon(boolean hexagon) {
            this.useHexagon = hexagon;
            return this;
        }

        public InferenceParams withNBatch(int nBatch) {
            this.nBatch = nBatch;
            return this;
        }

        public InferenceParams withNUBatch(int nUBatch) {
            this.nUBatch = nUBatch;
            return this;
        }

        public InferenceParams withFlashAttn(boolean flashAttn) {
            this.flashAttn = flashAttn;
            return this;
        }

        public InferenceParams withCacheTypeK(String cacheTypeK) {
            this.cacheTypeK = cacheTypeK;
            return this;
        }

        public InferenceParams withCacheTypeV(String cacheTypeV) {
            this.cacheTypeV = cacheTypeV;
            return this;
        }

        public InferenceParams withNGpuLayers(int nGpuLayers) {
            this.nGpuLayers = nGpuLayers;
            return this;
        }
    }

    // Response data holder
    public static class Response {
        public String text;
        public float tokensPerSecond;
        public int contextUsed;
        public boolean interrupted;

        public Response(String text, float tps, int ctx, boolean interrupted) {
            this.text = text;
            this.tokensPerSecond = tps;
            this.contextUsed = ctx;
            this.interrupted = interrupted;
        }
    }

    static {
        // Best variant for this CPU, shared with LlamaCpp (one library per process)
        NativeLibrarySelector.load();
    }

    /**
     * Load a GGUF model file.
     * 
     * @param modelPath Path to the GGUF model file
     * @param params    Inference parameters
     * @throws IllegalStateException if loading fails
     */
    public void load(String modelPath, InferenceParams params) throws IllegalStateException {
        load(modelPath, "", params);
    }

    public void load(String modelPath, String multimodalProj, InferenceParams params) throws IllegalStateException {
        if (nativePtr != 0L) {
            close();
        }

        Log.i(TAG,
                "Loading model: " + modelPath + (multimodalProj.isEmpty() ? "" : " with projector: " + multimodalProj));
        nativePtr = loadModelNative(
                modelPath,
                multimodalProj,
                params.minP,
                params.temperature,
                params.storeChats,
                params.contextSize,
                params.chatTemplate != null ? params.chatTemplate : "",
                params.numThreads,
                params.useMmap,
                params.useMlock,
                params.useVulkan,
                params.useOpenCL,
                params.useHexagon,
                params.nBatch,
                params.nUBatch,
                params.flashAttn,
                params.cacheTypeK != null ? params.cacheTypeK : "f16",
                params.cacheTypeV != null ? params.cacheTypeV : "f16",
                params.nGpuLayers);

        if (nativePtr <= 0) {
            throw new IllegalStateException("Failed to load model: " + modelPath);
        }

        Log.i(TAG, "Model loaded successfully");
        this.isMultimodal = (multimodalProj != null && !multimodalProj.isEmpty());
    }

    public boolean isMultimodal() {
        return isMultimodal;
    }

    /**
     * Add a system prompt to the conversation.
     */
    public void addSystemPrompt(String prompt) {
        verifyHandle();
        addChatMessageNative(nativePtr, prompt, "system");
    }

    /**
     * Add a user message to the conversation history.
     */
    public void addUserMessage(String message) {
        verifyHandle();
        addChatMessageNative(nativePtr, message, "user");
    }

    /**
     * Add an assistant message to the conversation history.
     */
    public void addAssistantMessage(String message) {
        verifyHandle();
        addChatMessageNative(nativePtr, message, "assistant");
    }

    /**
     * Get the response generation speed in tokens per second.
     */
    public float getResponseGenerationSpeed() {
        verifyHandle();
        return getResponseGenerationSpeedNative(nativePtr);
    }

    /**
     * Get the number of tokens used in the context window.
     */
    public int getContextLengthUsed() {
        verifyHandle();
        return getContextSizeUsedNative(nativePtr);
    }

    /**
     * Get performance metrics as a JSON string.
     */
    public String getMetrics() {
        verifyHandle();
        return getMetricsNative(nativePtr);
    }

    /**
     * Check if the model is currently generating a response.
     */
    public boolean isGenerating() {
        return isGenerating.get();
    }

    /**
     * Generate a response with streaming callback.
     */
    public void getResponseStreaming(
            String query,
            Consumer<String> onToken,
            Consumer<Response> onComplete,
            Consumer<Exception> onError) {

        getResponseStreaming(query, new String[0], null, onToken, onComplete, onError);
    }

    public void getResponseStreaming(
            String query,
            String[] images,
            Consumer<String> onToken,
            Consumer<Response> onComplete,
            Consumer<Exception> onError) {
        getResponseStreaming(query, images, null, onToken, onComplete, onError);
    }

    public void getResponseStreaming(
            String query,
            String[] images,
            GenerationOptions options,
            Consumer<String> onToken,
            Consumer<Response> onComplete,
            Consumer<Exception> onError) {

        final long ptr;
        synchronized (this) {
            ptr = nativePtr;
            if (ptr == 0L) {
                onError.accept(new IllegalStateException("Model not loaded. Call load() first."));
                return;
            }
            if (!isGenerating.compareAndSet(false, true)) {
                onError.accept(new IllegalStateException("Generation already in progress"));
                return;
            }
            interruptRequested = false;
            final GenerationOptions opts = options != null ? options : new GenerationOptions();
            generationThread = new Thread(
                    () -> runGeneration(ptr, query, images, opts, onToken, onComplete, onError),
                    "LlamaCpp-Generation");
            generationThread.start();
        }
    }

    /** Generation thread body. Uses the handle captured at start: close() may zero nativePtr meanwhile. */
    private void runGeneration(long ptr, String query, String[] images, GenerationOptions opts,
            Consumer<String> onToken, Consumer<Response> onComplete, Consumer<Exception> onError) {
        StringBuilder fullResponse = new StringBuilder();
        StopSequenceFilter stopFilter = new StopSequenceFilter(opts.stop);
        Exception failure = null;
        try {
            setSamplingNative(ptr, opts.temperature, opts.topP, opts.nPredict);
            startCompletionNative(ptr, query, images != null ? images : new String[0]);

            long lastEmitTime = System.currentTimeMillis();
            StringBuilder buffer = new StringBuilder();
            String piece = completionLoopNative(ptr);
            while (!"[EOG]".equals(piece) && !interruptRequested) {
                if (!piece.isEmpty()) {
                    String out = stopFilter.push(piece);
                    fullResponse.append(out);
                    buffer.append(out);
                    if (stopFilter.isStopped()) break;
                } else {
                    // Yield to OS during heavy prompt chunk decoding to prevent GPU starvation and UI ANRs
                    try {
                        Thread.sleep(10);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                }

                long now = System.currentTimeMillis();
                // Flush buffer every 50ms to prevent Capacitor JS bridge stutter
                if (buffer.length() > 0 && (now - lastEmitTime > 50)) {
                    onToken.accept(buffer.toString());
                    buffer.setLength(0);
                    lastEmitTime = now;
                }
                piece = completionLoopNative(ptr);
            }

            String tail = stopFilter.flush();
            fullResponse.append(tail);
            buffer.append(tail);
            if (buffer.length() > 0) {
                onToken.accept(buffer.toString());
            }
            stopCompletionNative(ptr);
        } catch (Exception e) {
            // After interrupt()/close() the handle may be gone: that is a normal stop, not an error
            if (!interruptRequested) failure = e;
        } finally {
            synchronized (this) {
                generationThread = null;
            }
            isGenerating.set(false);
        }

        try {
            if (failure != null) {
                onError.accept(failure);
            } else {
                // Native getters return 0 for a handle closed meanwhile
                onComplete.accept(new Response(fullResponse.toString(),
                        getResponseGenerationSpeedNative(ptr), getContextSizeUsedNative(ptr), interruptRequested));
            }
        } catch (Exception e) {
            Log.e(TAG, "Generation callback failed", e);
        }
    }

    /**
     * Generate a response synchronously (blocking).
     */
    public String getResponse(String query) {
        final long ptr;
        synchronized (this) {
            ptr = nativePtr;
            if (ptr == 0L) throw new IllegalStateException("Model not loaded. Call load() first.");
            if (!isGenerating.compareAndSet(false, true)) throw new IllegalStateException("Generation already in progress");
            interruptRequested = false;
            generationThread = Thread.currentThread();
        }
        try {
            setSamplingNative(ptr, -1f, -1f, 0);
            StringBuilder response = new StringBuilder();
            startCompletionNative(ptr, query, new String[0]);
            String piece = completionLoopNative(ptr);
            while (!"[EOG]".equals(piece) && !interruptRequested) {
                response.append(piece);
                piece = completionLoopNative(ptr);
            }
            stopCompletionNative(ptr);
            return response.toString();
        } finally {
            synchronized (this) {
                generationThread = null;
            }
            isGenerating.set(false);
        }
    }

    /**
     * Interrupt the current generation: a decode in progress aborts, the loop then ends.
     */
    public void interrupt() {
        interruptRequested = true;
        long ptr = nativePtr;
        if (ptr != 0L) {
            interruptNative(ptr);
        }
    }

    /**
     * Close the model and free all resources. Waits for a running generation to stop; if it
     * does not in time, native frees the model when that generation's current call returns.
     */
    public void close() {
        final long ptr;
        final Thread running;
        synchronized (this) {
            ptr = nativePtr;
            if (ptr == 0L) return;
            nativePtr = 0L;
            running = generationThread;
        }
        interruptRequested = true;
        interruptNative(ptr);
        if (running != null && running != Thread.currentThread()) {
            try {
                running.join(CLOSE_WAIT_MS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        closeNative(ptr);
        Log.i(TAG, "Model closed");
    }

    /**
     * Check if a model is loaded.
     */
    public boolean isLoaded() {
        long ptr = nativePtr;
        return ptr != 0L && isModelLoadedNative(ptr);
    }

    /**
     * Get the number of messages in the chat history.
     */
    public int getMessageCount() {
        long ptr = nativePtr;
        return ptr != 0L ? getMessageCountNative(ptr) : 0;
    }

    /**
     * Explicitly reset the context (history and KV cache).
     */
    public void resetContext() {
        long ptr = nativePtr;
        if (ptr != 0L) {
            resetContextNative(ptr);
        }
    }

    /**
     * Save KV cache state for a specific sequence to a file.
     * @param filepath Path to save the state file
     * @param seqId Sequence ID (0 for main conversation)
     * @return true on success
     */
    public boolean saveState(String filepath, int seqId) {
        long ptr = nativePtr;
        return ptr != 0L && saveStateNative(ptr, filepath, seqId);
    }

    /**
     * Load KV cache state for a specific sequence from a file.
     * @param filepath Path to the state file
     * @param seqId Destination sequence ID (0 for main conversation)
     * @return true on success
     */
    public boolean loadState(String filepath, int seqId) {
        long ptr = nativePtr;
        return ptr != 0L && loadStateNative(ptr, filepath, seqId);
    }

    /**
     * Get formatted chat string directly from the LLM model using its template engine.
     */
    public String getFormattedChat(String messages, String chatTemplate) {
        verifyHandle();
        return getFormattedChatNative(nativePtr, messages, chatTemplate);
    }

    private void verifyHandle() {
        if (nativePtr == 0L) {
            throw new IllegalStateException("Model not loaded. Call load() first.");
        }
    }

    // Native method declarations
    private native long loadModelNative(
            String modelPath, String multimodalProj, float minP, float temperature, boolean storeChats,
            int contextSize, String chatTemplate, int nThreads,
            boolean useMmap, boolean useMlock, boolean useVulkan, boolean useOpenCL, boolean useHexagon,
            int nBatch, int nUBatch, boolean flashAttn,
            String cacheTypeK, String cacheTypeV, int nGpuLayers);

    private native void addChatMessageNative(long modelPtr, String message, String role);

    private native float getResponseGenerationSpeedNative(long modelPtr);

    private native int getContextSizeUsedNative(long modelPtr);

    private native String getMetricsNative(long modelPtr);

    private native void closeNative(long modelPtr);

    private native void startCompletionNative(long modelPtr, String prompt, Object[] images);

    private native String completionLoopNative(long modelPtr);

    private native void interruptNative(long modelPtr);

    private native void setSamplingNative(long modelPtr, float temperature, float topP, int nPredict);

    private native void stopCompletionNative(long modelPtr);

    private native boolean isModelLoadedNative(long modelPtr);

    private native int getMessageCountNative(long modelPtr);

    private native void resetContextNative(long modelPtr);

    private native String getFormattedChatNative(long modelPtr, String messages, String chatTemplate);

    private native boolean saveStateNative(long modelPtr, String filepath, int seqId);

    private native boolean loadStateNative(long modelPtr, String filepath, int seqId);
}
