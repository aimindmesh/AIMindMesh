/*
 * LlamaCppInference.java - High-performance LLM inference wrapper
 * 
 * Provides native llama.cpp integration for GGUF models, including:
 * - CPU feature detection for optimal library loading
 * - Token-by-token streaming
 * - Proper chat history management
 * - Performance metrics
 */

package com.aimindmesh.llama;

import android.os.Build;
import android.util.Log;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

public class LlamaCppInference {
    private static final String TAG = "LlamaCppInference";
    private long nativePtr = 0L;
    private AtomicBoolean isGenerating = new AtomicBoolean(false);
    private boolean isMultimodal = false;

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
        try {
            loadOptimalLibrary();
        } catch (UnsatisfiedLinkError e) {
            Log.e(TAG, "Failed to load native library: " + e.getMessage());
            throw e;
        }
    }

    /**
     * Load the most optimal native library based on CPU features.
     */
    private static void loadOptimalLibrary() {
        String cpuFeatures = getCPUFeatures();
        boolean hasFp16 = cpuFeatures.contains("fp16") || cpuFeatures.contains("fphp");
        boolean hasDotProd = cpuFeatures.contains("dotprod") || cpuFeatures.contains("asimddp");
        boolean hasSve = cpuFeatures.contains("sve");
        boolean hasI8mm = cpuFeatures.contains("i8mm");
        boolean isAtLeastArmV82 = cpuFeatures.contains("asimd") &&
                cpuFeatures.contains("crc32") &&
                cpuFeatures.contains("aes");
        boolean isAtLeastArmV84 = cpuFeatures.contains("dcpop") && cpuFeatures.contains("uscat");

        Log.d(TAG, "CPU features: " + cpuFeatures);
        Log.d(TAG, "- hasFp16: " + hasFp16);
        Log.d(TAG, "- hasDotProd: " + hasDotProd);
        Log.d(TAG, "- hasSve: " + hasSve);
        Log.d(TAG, "- hasI8mm: " + hasI8mm);
        Log.d(TAG, "- isAtLeastArmV82: " + isAtLeastArmV82);
        Log.d(TAG, "- isAtLeastArmV84: " + isAtLeastArmV84);

        // Check if running on emulator
        boolean isEmulated = Build.HARDWARE.contains("goldfish") || Build.HARDWARE.contains("ranchu");
        Log.d(TAG, "isEmulated: " + isEmulated);

        String libraryName = "llama_cpp"; // Default fallback

        if (!isEmulated && supportsArm64V8a()) {
            if (isAtLeastArmV84 && hasSve && hasI8mm && hasFp16 && hasDotProd) {
                libraryName = "llama_cpp_v8_4_fp16_dotprod_i8mm_sve";
            } else if (isAtLeastArmV84 && hasSve && hasFp16 && hasDotProd) {
                libraryName = "llama_cpp_v8_4_fp16_dotprod_sve";
            } else if (isAtLeastArmV84 && hasI8mm && hasFp16 && hasDotProd) {
                libraryName = "llama_cpp_v8_4_fp16_dotprod_i8mm";
            } else if (isAtLeastArmV84 && hasFp16 && hasDotProd) {
                libraryName = "llama_cpp_v8_4_fp16_dotprod";
            } else if (isAtLeastArmV82 && hasFp16 && hasDotProd) {
                libraryName = "llama_cpp_v8_2_fp16_dotprod";
            } else if (isAtLeastArmV82 && hasFp16) {
                libraryName = "llama_cpp_v8_2_fp16";
            } else {
                libraryName = "llama_cpp_v8";
            }
        } else if (!isEmulated && Build.SUPPORTED_32_BIT_ABIS.length > 0 &&
                "armeabi-v7a".equals(Build.SUPPORTED_32_BIT_ABIS[0])) {
            libraryName = "llama_cpp_v7a";
        }

        Log.i(TAG, "Loading native library: lib" + libraryName + ".so");
        System.loadLibrary(libraryName);
        Log.i(TAG, "Successfully loaded native library: " + libraryName);
    }

    /**
     * Read CPU features from /proc/cpuinfo.
     */
    private static String getCPUFeatures() {
        try {
            File cpuInfoFile = new File("/proc/cpuinfo");
            if (!cpuInfoFile.exists())
                return "";

            try (BufferedReader reader = new BufferedReader(new FileReader(cpuInfoFile))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (line.toLowerCase().startsWith("features")) {
                        int colonIndex = line.indexOf(':');
                        if (colonIndex > 0) {
                            return line.substring(colonIndex + 1).trim().toLowerCase();
                        }
                    }
                }
            }
        } catch (IOException e) {
            Log.e(TAG, "Failed to read CPU features: " + e.getMessage());
        }
        return "";
    }

    private static boolean supportsArm64V8a() {
        return Build.SUPPORTED_ABIS.length > 0 && "arm64-v8a".equals(Build.SUPPORTED_ABIS[0]);
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

        getResponseStreaming(query, new String[0], onToken, onComplete, onError);
    }

    public void getResponseStreaming(
            String query,
            String[] images,
            Consumer<String> onToken,
            Consumer<Response> onComplete,
            Consumer<Exception> onError) {

        verifyHandle();

        if (isGenerating.get()) {
            onError.accept(new IllegalStateException("Generation already in progress"));
            return;
        }

        isGenerating.set(true);

        new Thread(() -> {
            StringBuilder fullResponse = new StringBuilder();
            boolean wasInterrupted = false;

            try {
                Log.d(TAG, "[LLM_CHAIN] Calling startCompletionNative for query length: " + (query != null ? query.length() : 0));
                startCompletionNative(nativePtr, query, images);
                Log.d(TAG, "[LLM_CHAIN] startCompletionNative finished. Starting loop.");

                long lastEmitTime = System.currentTimeMillis();
                StringBuilder buffer = new StringBuilder();

                Log.d(TAG, "[LLM_CHAIN] Entering completionLoopNative...");
                String piece = completionLoopNative(nativePtr);
                int loopCount = 0;
                
                while (!"[EOG]".equals(piece)) {
                    loopCount++;
                    Log.d(TAG, "[LLM_CHAIN] Loop " + loopCount + " received piece: [" + piece + "], empty? " + piece.isEmpty());
                    
                    if (!piece.isEmpty()) {
                        fullResponse.append(piece);
                        buffer.append(piece);
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
                        Log.d(TAG, "[LLM_CHAIN] Emitting buffered tokens to Capacitor: [" + buffer.toString() + "]");
                        onToken.accept(buffer.toString());
                        buffer.setLength(0);
                        lastEmitTime = now;
                    }

                    Log.d(TAG, "[LLM_CHAIN] Calling completionLoopNative for next piece...");
                    piece = completionLoopNative(nativePtr);
                }
                
                Log.d(TAG, "[LLM_CHAIN] Generation loop exited with [EOG]. Total loops: " + loopCount);

                // Flush any final remaining tokens before [EOG]
                if (buffer.length() > 0) {
                    Log.d(TAG, "[LLM_CHAIN] Emitting final buffered tokens: [" + buffer.toString() + "]");
                    onToken.accept(buffer.toString());
                }

                Log.d(TAG, "[LLM_CHAIN] Calling stopCompletionNative...");
                stopCompletionNative(nativePtr);
                Log.d(TAG, "[LLM_CHAIN] stopCompletionNative finished.");

            } catch (IllegalStateException e) {
                if (e.getMessage() != null && e.getMessage().contains("interrupt")) {
                    wasInterrupted = true;
                    stopCompletionNative(nativePtr);
                } else {
                    isGenerating.set(false);
                    onError.accept(e);
                    return;
                }
            } catch (Exception e) {
                isGenerating.set(false);
                onError.accept(e);
                return;
            }

            isGenerating.set(false);

            Response response = new Response(
                    fullResponse.toString(),
                    getResponseGenerationSpeed(),
                    getContextLengthUsed(),
                    wasInterrupted);
            onComplete.accept(response);

        }, "LlamaCpp-Generation").start();
    }

    /**
     * Generate a response synchronously (blocking).
     */
    public String getResponse(String query) {
        verifyHandle();

        StringBuilder response = new StringBuilder();
        startCompletionNative(nativePtr, query, new String[0]);

        String piece = completionLoopNative(nativePtr);
        while (!"[EOG]".equals(piece)) {
            response.append(piece);
            piece = completionLoopNative(nativePtr);
        }

        stopCompletionNative(nativePtr);
        return response.toString();
    }

    /**
     * Interrupt the current generation.
     */
    public void interrupt() {
        if (nativePtr != 0L) {
            interruptNative(nativePtr);
        }
    }

    /**
     * Close the model and free all resources.
     */
    public void close() {
        if (nativePtr != 0L) {
            interrupt();
            closeNative(nativePtr);
            nativePtr = 0L;
            Log.i(TAG, "Model closed");
        }
    }

    /**
     * Check if a model is loaded.
     */
    public boolean isLoaded() {
        return nativePtr != 0L && isModelLoadedNative(nativePtr);
    }

    /**
     * Get the number of messages in the chat history.
     */
    public int getMessageCount() {
        if (nativePtr != 0L) {
            return getMessageCountNative(nativePtr);
        }
        return 0;
    }

    /**
     * Explicitly reset the context (history and KV cache).
     */
    public void resetContext() {
        if (nativePtr != 0L) {
            resetContextNative(nativePtr);
        }
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

    private native void stopCompletionNative(long modelPtr);

    private native boolean isModelLoadedNative(long modelPtr);

    private native int getMessageCountNative(long modelPtr);

    private native void resetContextNative(long modelPtr);

    private native String getFormattedChatNative(long modelPtr, String messages, String chatTemplate);
}
