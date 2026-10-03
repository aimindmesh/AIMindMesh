package com.aimindmesh.llama;

import android.content.Context;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * LlamaCpp streaming API ("SmolLM" methods of LlamaCppPlugin), moved out of the plugin class.
 *
 * Model load/close and KV state files run on one lifecycle thread: they take seconds, and on the
 * shared Capacitor plugin thread they would stall every other plugin call.
 */
final class SmolLMController {
    private static final String TAG = "LlamaCppPlugin";

    interface Emitter {
        void emit(String eventName, JSObject data);
    }

    // STATIC: Persist across Activity recreation (WebView reload)
    private static final Map<Integer, LlamaCppInference> inferenceInstances = new ConcurrentHashMap<>();
    private static final Map<Integer, String> loadedModelPaths = new ConcurrentHashMap<>();
    private static final ExecutorService lifecycle =
            Executors.newSingleThreadExecutor(r -> new Thread(r, "LlamaCpp-Lifecycle"));

    private final Context context;
    private final LlamaCpp implementation;
    private final Emitter emitter;

    SmolLMController(Context context, LlamaCpp implementation, Emitter emitter) {
        this.context = context;
        this.implementation = implementation;
        this.emitter = emitter;
    }

    LlamaCppInference get(int contextId) {
        return inferenceInstances.get(contextId);
    }

    /** Runs blocking work on the lifecycle thread; failures reject the call instead of crashing. */
    private void runLifecycle(PluginCall call, String what, Runnable work) {
        lifecycle.execute(() -> {
            try {
                work.run();
            } catch (Exception e) {
                Log.e(TAG, what + " failed: " + e.getMessage(), e);
                call.reject(what + " failed: " + e.getMessage());
            }
        });
    }

    void init(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        String modelPath = call.getString("modelPath", "");
        String multimodalProj = call.getString("multimodalProj", ""); // Optional multimodal projector path
        JSObject params = call.getObject("params", new JSObject());

        if (modelPath == null || modelPath.isEmpty()) {
            call.reject("Model path is required");
            return;
        }
        final String projector = multimodalProj != null ? multimodalProj : "";

        runLifecycle(call, "Failed to initialize LlamaCpp inference", () -> {
            // Check if THIS specific model is already loaded in this slot
            String loadedPath = loadedModelPaths.get(contextId);
            LlamaCppInference existing = inferenceInstances.get(contextId);

            if (existing != null && modelPath.equals(loadedPath)) {
                Log.i(TAG, "🟢 Context " + contextId + " already has model " + modelPath + " loaded. Reusing...");
                JSObject result = new JSObject();
                result.put("contextId", contextId);
                result.put("success", true);
                result.put("architecture", "llamacpp");
                result.put("reused", true);
                call.resolve(result);
                return;
            }

            // If different model or not loaded, close existing (waits for its generation to stop)
            if (existing != null) {
                Log.i(TAG, "♻️ Context " + contextId + " has different model loaded (" + loadedPath + "). Unloading...");
                inferenceInstances.remove(contextId);
                loadedModelPaths.remove(contextId);
                existing.close();
            }

            LlamaCppInference inference = new LlamaCppInference();
            LlamaCppInference.InferenceParams inferenceParams = new LlamaCppInference.InferenceParams()
                    .withTemperature((float) params.optDouble("temperature", 0.7))
                    .withMinP((float) params.optDouble("min_p", 0.1))
                    .withContextSize(params.optInt("n_ctx", 2048))
                    .withNumThreads(params.optInt("n_threads", 4))
                    .withMmap(params.optBoolean("use_mmap", true))
                    .withMlock(params.optBoolean("use_mlock", false))
                    .withVulkan(params.optBoolean("use_vulkan", false))
                    .withOpenCL(params.optBoolean("use_opencl", false))
                    .withHexagon(params.optBoolean("use_hexagon", false))
                    .withStoreChats(params.optBoolean("store_chats", true))
                    .withNBatch(params.optInt("n_batch", 512))
                    .withNUBatch(params.optInt("n_ubatch", 256))
                    .withFlashAttn(params.optBoolean("flash_attn", true))
                    .withCacheTypeK(params.optString("cache_type_k", "f16"))
                    .withCacheTypeV(params.optString("cache_type_v", "f16"))
                    .withNGpuLayers(params.optInt("n_gpu_layers", 99));

            String chatTemplate = params.getString("chat_template");
            if (chatTemplate != null && !chatTemplate.isEmpty()) {
                inferenceParams.withChatTemplate(chatTemplate);
            }

            // Resolve model path with search paths
            String resolvedPath = implementation.resolveModelPath(modelPath);
            Log.i(TAG, "Loading GGUF model: " + resolvedPath +
                    (projector.isEmpty() ? "" : " and projector: " + projector));
            inference.load(resolvedPath, projector, inferenceParams);

            // Add system prompt if provided
            String systemPrompt = params.getString("system_prompt");
            if (systemPrompt != null && !systemPrompt.isEmpty()) {
                inference.addSystemPrompt(systemPrompt);
            }

            inferenceInstances.put(contextId, inference);
            loadedModelPaths.put(contextId, modelPath);

            JSObject result = new JSObject();
            result.put("contextId", contextId);
            result.put("success", true);
            result.put("architecture", "llamacpp");
            call.resolve(result);
        });
    }

    /**
     * Generate a streaming response. Emits tokens via Capacitor events as they are generated.
     * Optional top-level options: nPredict (<= 0 unlimited), temperature, topP, stop (string[]).
     */
    void streamingCompletion(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        String prompt = call.getString("prompt", "");
        JSArray imagesArray = call.getArray("images", new JSArray());

        Log.i(TAG, "🚀 streamingCompletion called: contextId=" + contextId + " promptLen=" + (prompt != null ? prompt.length() : 0) + " instances=" + inferenceInstances.size());

        LlamaCppInference inference = inferenceInstances.get(contextId);
        if (inference == null) {
            Log.e(TAG, "❌ streamingCompletion: No inference instance for contextId=" + contextId + ". Available: " + inferenceInstances.keySet());
            call.reject("LlamaCpp context not found. Call initSmolLM first.");
            return;
        }

        if (prompt == null || prompt.isEmpty()) {
            call.reject("Prompt is required");
            return;
        }

        String[] images = toStringArray(imagesArray);
        LlamaCppInference.GenerationOptions options = new LlamaCppInference.GenerationOptions();
        Integer nPredict = call.getInt("nPredict");
        Float temperature = call.getFloat("temperature");
        Float topP = call.getFloat("topP");
        if (nPredict != null) options.nPredict = nPredict;
        if (temperature != null) options.temperature = temperature;
        if (topP != null) options.topP = topP;
        options.stop = toStringArray(call.getArray("stop"));

        final StringBuilder tokenBuffer = new StringBuilder();
        final long[] lastEmitTime = {System.currentTimeMillis()};

        inference.getResponseStreaming(
                prompt,
                images,
                options,
                token -> {
                    synchronized (tokenBuffer) {
                        tokenBuffer.append(token);
                        long now = System.currentTimeMillis();
                        if (now - lastEmitTime[0] >= 100) {
                            String batched = tokenBuffer.toString();
                            tokenBuffer.setLength(0);
                            lastEmitTime[0] = now;
                            emitToken(contextId, batched);
                        }
                    }
                },
                response -> {
                    synchronized (tokenBuffer) {
                        if (tokenBuffer.length() > 0) {
                            emitToken(contextId, tokenBuffer.toString());
                            tokenBuffer.setLength(0);
                        }
                    }
                    Log.i(TAG, "[LLM_CHAIN] Generation completed natively. text length: " + (response.text != null ? response.text.length() : 0));
                    JSObject result = new JSObject();
                    result.put("text", response.text);
                    result.put("tokensPerSecond", response.tokensPerSecond);
                    result.put("contextUsed", response.contextUsed);
                    result.put("interrupted", response.interrupted);
                    call.resolve(result);
                },
                error -> {
                    Log.e(TAG, "[LLM_CHAIN] Generation failed natively: " + error.getMessage(), error);
                    call.reject("Generation failed: " + error.getMessage());
                });
    }

    private void emitToken(int contextId, String token) {
        JSObject tokenEvent = new JSObject();
        tokenEvent.put("contextId", contextId);
        tokenEvent.put("token", token);
        emitter.emit("smolLMToken", tokenEvent);
    }

    private static String[] toStringArray(JSArray array) {
        if (array == null) return new String[0];
        List<String> list = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) {
            try {
                list.add(array.getString(i));
            } catch (JSONException e) {
                Log.e(TAG, "Skipping non-string array entry: " + e.getMessage());
            }
        }
        return list.toArray(new String[0]);
    }

    /**
     * Generate a complete response (blocking).
     */
    void completion(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        String prompt = call.getString("prompt", "");

        LlamaCppInference inference = inferenceInstances.get(contextId);
        if (inference == null) {
            call.reject("LlamaCpp context not found. Call initSmolLM first.");
            return;
        }

        if (prompt == null || prompt.isEmpty()) {
            call.reject("Prompt is required");
            return;
        }

        new Thread(() -> {
            try {
                String response = inference.getResponse(prompt);

                JSObject result = new JSObject();
                result.put("text", response);
                result.put("tokensPerSecond", inference.isLoaded() ? inference.getResponseGenerationSpeed() : 0f);
                result.put("contextUsed", inference.isLoaded() ? inference.getContextLengthUsed() : 0);
                call.resolve(result);

            } catch (Exception e) {
                call.reject("Generation failed: " + e.getMessage());
            }
        }, "LlamaCpp-Completion").start();
    }

    /**
     * Add a message to the chat history.
     */
    void addMessage(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        String message = call.getString("message", "");
        String role = call.getString("role", "user");

        LlamaCppInference inference = inferenceInstances.get(contextId);
        if (inference == null) {
            call.reject("LlamaCpp context not found. Call initSmolLM first.");
            return;
        }

        try {
            switch (role) {
                case "system":
                    inference.addSystemPrompt(message);
                    break;
                case "assistant":
                    inference.addAssistantMessage(message);
                    break;
                case "user":
                default:
                    inference.addUserMessage(message);
                    break;
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to add message: " + e.getMessage());
        }
    }

    /**
     * Interrupt an ongoing generation (a decode in progress aborts promptly).
     */
    void interrupt(PluginCall call) {
        int contextId = call.getInt("contextId", 0);

        LlamaCppInference inference = inferenceInstances.get(contextId);
        if (inference != null) {
            inference.interrupt();
        }
        call.resolve();
    }

    /**
     * Get generation metrics.
     */
    void metrics(PluginCall call) {
        int contextId = call.getInt("contextId", 0);

        LlamaCppInference inference = inferenceInstances.get(contextId);
        if (inference == null || !inference.isLoaded()) {
            call.reject("LlamaCpp context not found");
            return;
        }

        try {
            JSObject result = new JSObject();
            result.put("tokensPerSecond", inference.getResponseGenerationSpeed());
            result.put("contextUsed", inference.getContextLengthUsed());
            result.put("isGenerating", inference.isGenerating());
            result.put("isLoaded", inference.isLoaded());
            result.put("modelPath", loadedModelPaths.get(contextId));
            result.put("messageCount", inference.getMessageCount());

            try {
                JSONObject metrics = new JSONObject(inference.getMetrics());
                Iterator<String> keys = metrics.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    result.put(key, metrics.get(key));
                }
            } catch (Exception e) {
                Log.w(TAG, "Failed to parse detailed metrics: " + e.getMessage());
            }

            call.resolve(result);
        } catch (IllegalStateException e) {
            // Closed between the check and the read
            call.reject("LlamaCpp context not found");
        }
    }

    /**
     * Resets the context (history and KV cache).
     */
    void reset(PluginCall call) {
        int contextId = call.getInt("contextId", 0);

        LlamaCppInference inference = inferenceInstances.get(contextId);
        if (inference == null) {
            call.reject("LlamaCpp context not found");
            return;
        }

        inference.resetContext();
        call.resolve();
    }

    /**
     * Release a context.
     */
    void release(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        runLifecycle(call, "Release", () -> {
            LlamaCppInference inference = inferenceInstances.remove(contextId);
            loadedModelPaths.remove(contextId);
            if (inference != null) {
                inference.close();
                Log.i(TAG, "LlamaCpp context " + contextId + " released");
            }
            call.resolve();
        });
    }

    /**
     * Release all contexts.
     */
    void releaseAll(PluginCall call) {
        runLifecycle(call, "Release", () -> {
            List<LlamaCppInference> all = new ArrayList<>(inferenceInstances.values());
            inferenceInstances.clear();
            loadedModelPaths.clear();
            for (LlamaCppInference inference : all) {
                inference.close();
            }
            Log.i(TAG, "All LlamaCpp contexts released");
            call.resolve();
        });
    }

    private File kvCacheFile(String slotName, int contextId) {
        return new File(new File(context.getFilesDir(), "kv_cache"), slotName + "_" + contextId + ".bin");
    }

    void saveKvCache(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        String slotName = call.getString("slot", "chat");

        LlamaCppInference inference = inferenceInstances.get(contextId);
        if (inference == null) {
            call.reject("No inference instance for contextId " + contextId);
            return;
        }

        runLifecycle(call, "Save KV cache", () -> {
            File stateFile = kvCacheFile(slotName, contextId);
            stateFile.getParentFile().mkdirs();
            String filepath = stateFile.getAbsolutePath();
            if (inference.saveState(filepath, 0)) {
                Log.i(TAG, "KV cache saved for context " + contextId + " to " + filepath);
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("filepath", filepath);
                call.resolve(ret);
            } else {
                call.reject("Failed to save KV cache for context " + contextId);
            }
        });
    }

    void restoreKvCache(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        String slotName = call.getString("slot", "chat");

        LlamaCppInference inference = inferenceInstances.get(contextId);
        if (inference == null) {
            call.reject("No inference instance for contextId " + contextId);
            return;
        }

        runLifecycle(call, "Restore KV cache", () -> {
            File stateFile = kvCacheFile(slotName, contextId);
            if (!stateFile.exists()) {
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("reason", "file_not_found");
                call.resolve(ret);
                return;
            }
            if (inference.loadState(stateFile.getAbsolutePath(), 0)) {
                Log.i(TAG, "KV cache restored for context " + contextId + " from " + stateFile);
                JSObject ret = new JSObject();
                ret.put("success", true);
                call.resolve(ret);
            } else {
                call.reject("Failed to restore KV cache for context " + contextId);
            }
        });
    }

    void invalidateKvCache(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        String slotName = call.getString("slot", "chat");

        File stateFile = kvCacheFile(slotName, contextId);
        boolean deleted = false;
        if (stateFile.exists()) {
            deleted = stateFile.delete();
            Log.i(TAG, "KV cache invalidated for context " + contextId + ": " + (deleted ? "deleted" : "delete failed"));
        }

        JSObject ret = new JSObject();
        ret.put("success", deleted || !stateFile.exists());
        call.resolve(ret);
    }
}
