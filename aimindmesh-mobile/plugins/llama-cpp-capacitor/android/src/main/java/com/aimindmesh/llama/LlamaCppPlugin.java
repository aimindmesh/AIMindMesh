package com.aimindmesh.llama;

import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Map;
import org.json.JSONException;
import org.json.JSONObject;
import android.content.Context;
import android.content.ComponentCallbacks2;
import android.content.res.Configuration;
import android.os.Environment;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.HashMap;
import java.util.Iterator;
import okhttp3.*;
import java.io.IOException;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "LlamaCpp")
public class LlamaCppPlugin extends Plugin {
    private static final String TAG = "LlamaCppPlugin";

    private LlamaCpp implementation;

    // LlamaCpp inference instances for streaming (new architecture)
    // STATIC: Persist across Activity recreation (WebView reload)
    private static Map<Integer, LlamaCppInference> inferenceInstances = new HashMap<>();
    private static Map<Integer, String> loadedModelPaths = new HashMap<>();

    @Override
    public void load() {
        super.load();
        // Initialize implementation with context
        implementation = new LlamaCpp(getContext());
        Log.i(TAG, "LlamaCppPlugin loaded successfully");

        // Register memory callbacks
        getContext().registerComponentCallbacks(new ComponentCallbacks2() {
            @Override
            public void onTrimMemory(int level) {
                // Emit event to JS
                JSObject ret = new JSObject();
                ret.put("level", level);
                notifyListeners("onTrimMemory", ret);

                // Log memory pressure to help debug crashes
                switch (level) {
                    case ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN:
                        // Only log debug, this is normal
                        break;
                    case ComponentCallbacks2.TRIM_MEMORY_RUNNING_MODERATE:
                    case ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW:
                        Log.w(TAG, "⚠️ Memory Pressure: Running Low (Level " + level + ")");
                        break;
                    case ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL:
                        Log.e(TAG, "🚨 Memory Pressure: CRITICAL - App risk of being killed! (Level " + level + ")");
                        break;
                    case ComponentCallbacks2.TRIM_MEMORY_COMPLETE:
                        Log.e(TAG,
                                "🚨 Memory Pressure: COMPLETE - App acting as background process, likely to be killed. (Level "
                                        + level + ")");
                        break;
                    default:
                        if (level >= ComponentCallbacks2.TRIM_MEMORY_MODERATE) {
                            Log.w(TAG, "⚠️ Memory Pressure: Moderate+ (Level " + level + ")");
                        }
                        break;
                }
            }

            @Override
            public void onConfigurationChanged(Configuration newConfig) {
            }

            @Override
            public void onLowMemory() {
                Log.e(TAG, "🚨 LOW MEMORY reported by system application-wide!");
                notifyListeners("onLowMemory", new JSObject());
            }
        });
    }

    // MARK: - Core initialization and management

    @PluginMethod
    public void toggleNativeLog(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        implementation.toggleNativeLog(enabled, result -> {
            if (result.isSuccess()) {
                call.resolve();
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void setContextLimit(PluginCall call) {
        int limit = call.getInt("limit", 10);
        implementation.setContextLimit(limit, result -> {
            if (result.isSuccess()) {
                call.resolve();
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void modelInfo(PluginCall call) {
        String path = call.getString("path", "");
        JSArray skipArray = call.getArray("skip");
        String[] skip = new String[0];
        if (skipArray != null) {
            skip = new String[skipArray.length()];
            for (int i = 0; i < skipArray.length(); i++) {
                try {
                    skip[i] = skipArray.getString(i);
                } catch (JSONException e) {
                    skip[i] = "";
                }
            }
        }

        implementation.modelInfo(path, skip, result -> {
            if (result.isSuccess()) {
                JSObject jsResult = new JSObject();
                Map<String, Object> data = result.getData();
                for (Map.Entry<String, Object> entry : data.entrySet()) {
                    jsResult.put(entry.getKey(), entry.getValue());
                }
                call.resolve(jsResult);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void initContext(PluginCall call) {
        Log.i(TAG, "initContext called with contextId: " + call.getInt("contextId", 0));
        int contextId = call.getInt("contextId", 0);
        JSObject params = call.getObject("params", new JSObject());

        implementation.initContext(contextId, params, result -> {
            if (result.isSuccess()) {
                JSObject jsResult = new JSObject();
                Map<String, Object> data = result.getData();
                for (Map.Entry<String, Object> entry : data.entrySet()) {
                    jsResult.put(entry.getKey(), entry.getValue());
                }
                call.resolve(jsResult);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void releaseContext(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        implementation.releaseContext(contextId, result -> {
            if (result.isSuccess()) {
                call.resolve();
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void releaseAllContexts(PluginCall call) {
        implementation.releaseAllContexts(result -> {
            if (result.isSuccess()) {
                call.resolve();
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    // MARK: - Chat and completion

    @PluginMethod
    public void getFormattedChat(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        String messages = call.getString("messages", "");
        String chatTemplate = call.getString("chatTemplate", "");
        JSObject params = call.getObject("params", new JSObject());

        LlamaCppInference inference = inferenceInstances.get(contextId);
        if (inference != null && inference.isLoaded()) {
            try {
                Log.i(TAG, "Calling inference.getFormattedChat() for context: " + contextId);
                String result = inference.getFormattedChat(messages, chatTemplate);
                Log.i(TAG, "inference.getFormattedChat() completed");
                JSObject jsResult = new JSObject();
                jsResult.put("type", "llama-chat");
                jsResult.put("prompt", result);
                jsResult.put("has_media", false);
                jsResult.put("media_paths", new JSArray());
                call.resolve(jsResult);
            } catch (Exception e) {
                call.reject("Failed to format chat via LLMInference: " + e.getMessage());
            }
            return;
        }

        // Fallback to legacy cap-llama context if initialized via initContext
        implementation.getFormattedChat(contextId, messages, chatTemplate, params, result -> {
            if (result.isSuccess()) {
                Map<String, Object> data = result.getData();
                JSObject jsResult = convertMapToJSObject(data);
                call.resolve(jsResult);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void completion(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        JSObject params = call.getObject("params", new JSObject());

        implementation.completion(contextId, params, result -> {
            if (result.isSuccess()) {
                Map<String, Object> data = result.getData();
                JSObject jsResult = convertMapToJSObject(data);
                call.resolve(jsResult);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void stopCompletion(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        implementation.stopCompletion(contextId, result -> {
            if (result.isSuccess()) {
                call.resolve();
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    // MARK: - Chat-first methods (like llama-cli -sys)

    @PluginMethod
    public void chat(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        JSArray messagesArray = call.getArray("messages", new JSArray());
        String system = call.getString("system");
        String chatTemplate = call.getString("chatTemplate");
        JSObject params = call.getObject("params");

        try {
            // Convert JSArray to JSON string
            String messagesJson = messagesArray.toString();

            implementation.chat(contextId, messagesJson, system, chatTemplate, params, result -> {
                if (result.isSuccess()) {
                    Map<String, Object> data = result.getData();
                    JSObject jsResult = convertMapToJSObject(data);
                    call.resolve(jsResult);
                } else {
                    call.reject(result.getError().getMessage());
                }
            });
        } catch (Exception e) {
            call.reject("Failed to process chat request: " + e.getMessage());
        }
    }

    @PluginMethod
    public void chatWithSystem(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        String system = call.getString("system", "");
        String message = call.getString("message", "");
        JSObject params = call.getObject("params");

        implementation.chatWithSystem(contextId, system, message, params, result -> {
            if (result.isSuccess()) {
                Map<String, Object> data = result.getData();
                JSObject jsResult = convertMapToJSObject(data);
                call.resolve(jsResult);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void generateText(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        String prompt = call.getString("prompt", "");
        JSObject params = call.getObject("params");

        implementation.generateText(contextId, prompt, params, result -> {
            if (result.isSuccess()) {
                Map<String, Object> data = result.getData();
                JSObject jsResult = convertMapToJSObject(data);
                call.resolve(jsResult);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    // MARK: - Session management

    @PluginMethod
    public void loadSession(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        String filepath = call.getString("filepath", "");

        implementation.loadSession(contextId, filepath, result -> {
            if (result.isSuccess()) {
                Map<String, Object> data = result.getData();
                JSObject jsResult = convertMapToJSObject(data);
                call.resolve(jsResult);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void saveSession(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        String filepath = call.getString("filepath", "");
        int size = call.getInt("size", -1);

        implementation.saveSession(contextId, filepath, size, result -> {
            if (result.isSuccess()) {
                JSObject ret = new JSObject();
                ret.put("tokens_saved", result.getData());
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    // MARK: - Tokenization

    @PluginMethod
    public void tokenize(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        String text = call.getString("text", "");
        JSArray imagePathsArray = call.getArray("imagePaths");
        String[] imagePaths = new String[0];
        if (imagePathsArray != null) {
            imagePaths = new String[imagePathsArray.length()];
            for (int i = 0; i < imagePathsArray.length(); i++) {
                try {
                    imagePaths[i] = imagePathsArray.getString(i);
                } catch (JSONException e) {
                    imagePaths[i] = "";
                }
            }
        }

        implementation.tokenize(contextId, text, imagePaths, result -> {
            if (result.isSuccess()) {
                Map<String, Object> data = result.getData();
                JSObject jsResult = convertMapToJSObject(data);
                call.resolve(jsResult);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void detokenize(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        JSArray tokensArray = call.getArray("tokens");
        Integer[] tokens = new Integer[0];
        if (tokensArray != null) {
            tokens = new Integer[tokensArray.length()];
            for (int i = 0; i < tokensArray.length(); i++) {
                try {
                    tokens[i] = tokensArray.getInt(i);
                } catch (JSONException e) {
                    tokens[i] = 0;
                }
            }
        }

        implementation.detokenize(contextId, tokens, result -> {
            if (result.isSuccess()) {
                JSObject ret = new JSObject();
                ret.put("text", result.getData());
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    // MARK: - Embeddings and reranking

    @PluginMethod
    public void embedding(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        String text = call.getString("text", "");
        JSObject params = call.getObject("params", new JSObject());

        implementation.embedding(contextId, text, params, result -> {
            if (result.isSuccess()) {
                Map<String, Object> data = result.getData();
                JSObject jsResult = convertMapToJSObject(data);
                call.resolve(jsResult);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void rerank(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        String query = call.getString("query", "");
        JSArray documentsArray = call.getArray("documents");
        String[] documents = new String[0];
        if (documentsArray != null) {
            documents = new String[documentsArray.length()];
            for (int i = 0; i < documentsArray.length(); i++) {
                try {
                    documents[i] = documentsArray.getString(i);
                } catch (JSONException e) {
                    documents[i] = "";
                }
            }
        }
        JSObject params = call.getObject("params", new JSObject());

        implementation.rerank(contextId, query, documents, params, result -> {
            if (result.isSuccess()) {
                List<Map<String, Object>> data = result.getData();
                JSArray jsArray = convertListToJSArray(data);
                JSObject ret = new JSObject();
                ret.put("results", jsArray);
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    // MARK: - Benchmarking

    @PluginMethod
    public void bench(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        int pp = call.getInt("pp", 128);
        int tg = call.getInt("tg", 128);
        int pl = call.getInt("pl", 1);
        int nr = call.getInt("nr", 1);

        implementation.bench(contextId, pp, tg, pl, nr, result -> {
            if (result.isSuccess()) {
                JSObject ret = new JSObject();
                ret.put("result", result.getData());
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    // MARK: - LoRA adapters

    @PluginMethod
    public void applyLoraAdapters(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        JSArray loraAdaptersArray = call.getArray("loraAdapters");
        List<Map<String, Object>> loraAdapters = new ArrayList<>();

        if (loraAdaptersArray != null) {
            for (int i = 0; i < loraAdaptersArray.length(); i++) {
                try {
                    JSONObject adapter = loraAdaptersArray.getJSONObject(i);
                    Map<String, Object> adapterMap = new HashMap<>();
                    adapterMap.put("path", adapter.optString("path", ""));
                    adapterMap.put("scaled", adapter.optDouble("scaled", 1.0));
                    loraAdapters.add(adapterMap);
                } catch (JSONException e) {
                    Log.e(TAG, "Error parsing LoRA adapter: " + e.getMessage());
                }
            }
        }

        implementation.applyLoraAdapters(contextId, loraAdapters, result -> {
            if (result.isSuccess()) {
                call.resolve();
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void removeLoraAdapters(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        implementation.removeLoraAdapters(contextId, result -> {
            if (result.isSuccess()) {
                call.resolve();
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void getLoadedLoraAdapters(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        implementation.getLoadedLoraAdapters(contextId, result -> {
            if (result.isSuccess()) {
                List<Map<String, Object>> data = result.getData();
                JSArray jsArray = convertListToJSArray(data);
                JSObject ret = new JSObject();
                ret.put("adapters", jsArray);
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    // MARK: - Multimodal methods

    @PluginMethod
    public void initMultimodal(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        JSObject params = call.getObject("params", new JSObject());
        String path = params.getString("path", "");
        boolean useGpu = params.getBoolean("use_gpu", true);

        implementation.initMultimodal(contextId, path, useGpu, result -> {
            if (result.isSuccess()) {
                JSObject ret = new JSObject();
                ret.put("success", result.getData());
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void isMultimodalEnabled(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        implementation.isMultimodalEnabled(contextId, result -> {
            if (result.isSuccess()) {
                JSObject ret = new JSObject();
                ret.put("enabled", result.getData());
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void getMultimodalSupport(PluginCall call) {
        int contextId = call.getInt("contextId", 0);

        // Check LlamaCpp inference instances first
        LlamaCppInference inference = inferenceInstances.get(contextId);
        if (inference != null) {
            JSObject ret = new JSObject();
            ret.put("vision", inference.isMultimodal());
            ret.put("audio", false);
            call.resolve(ret);
            return;
        }

        implementation.getMultimodalSupport(contextId, result -> {
            if (result.isSuccess()) {
                Map<String, Object> data = result.getData();
                JSObject jsResult = convertMapToJSObject(data);
                call.resolve(jsResult);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void releaseMultimodal(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        implementation.releaseMultimodal(contextId, result -> {
            if (result.isSuccess()) {
                call.resolve();
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    // MARK: - TTS methods

    @PluginMethod
    public void initVocoder(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        JSObject params = call.getObject("params", new JSObject());
        String path = params.getString("path", "");
        Integer nBatch = params.getInteger("n_batch", 512);

        implementation.initVocoder(contextId, path, nBatch, result -> {
            if (result.isSuccess()) {
                JSObject ret = new JSObject();
                ret.put("success", result.getData());
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void isVocoderEnabled(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        implementation.isVocoderEnabled(contextId, result -> {
            if (result.isSuccess()) {
                JSObject ret = new JSObject();
                ret.put("enabled", result.getData());
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void getFormattedAudioCompletion(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        String speakerJsonStr = call.getString("speakerJsonStr", "");
        String textToSpeak = call.getString("textToSpeak", "");

        implementation.getFormattedAudioCompletion(contextId, speakerJsonStr, textToSpeak, result -> {
            if (result.isSuccess()) {
                Map<String, Object> data = result.getData();
                JSObject jsResult = convertMapToJSObject(data);
                call.resolve(jsResult);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void getAudioCompletionGuideTokens(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        String textToSpeak = call.getString("textToSpeak", "");

        implementation.getAudioCompletionGuideTokens(contextId, textToSpeak, result -> {
            if (result.isSuccess()) {
                List<Integer> data = result.getData();
                JSArray jsArray = new JSArray();
                for (Integer token : data) {
                    jsArray.put(token);
                }
                JSObject ret = new JSObject();
                ret.put("tokens", jsArray);
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void decodeAudioTokens(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        JSArray tokensArray = call.getArray("tokens");
        Integer[] tokens = new Integer[0];
        if (tokensArray != null) {
            tokens = new Integer[tokensArray.length()];
            for (int i = 0; i < tokensArray.length(); i++) {
                try {
                    tokens[i] = tokensArray.getInt(i);
                } catch (JSONException e) {
                    tokens[i] = 0;
                }
            }
        }

        implementation.decodeAudioTokens(contextId, tokens, result -> {
            if (result.isSuccess()) {
                List<Integer> data = result.getData();
                JSArray jsArray = new JSArray();
                for (Integer token : data) {
                    jsArray.put(token);
                }
                JSObject ret = new JSObject();
                ret.put("audioData", jsArray);
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void releaseVocoder(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        implementation.releaseVocoder(contextId, result -> {
            if (result.isSuccess()) {
                call.resolve();
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    // MARK: - Model download and management

    @PluginMethod
    public void downloadModel(PluginCall call) {
        String url = call.getString("url", "");
        String filename = call.getString("filename", "");
        String hfToken = call.getString("hfToken", "");

        implementation.downloadModel(url, filename, hfToken, result -> {
            if (result.isSuccess()) {
                JSObject ret = new JSObject();
                ret.put("localPath", result.getData());
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void getDownloadProgress(PluginCall call) {
        String url = call.getString("url", "");

        implementation.getDownloadProgress(url, result -> {
            if (result.isSuccess()) {
                Map<String, Object> data = result.getData();
                JSObject jsResult = convertMapToJSObject(data);
                call.resolve(jsResult);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        String url = call.getString("url", "");

        implementation.cancelDownload(url, result -> {
            if (result.isSuccess()) {
                JSObject ret = new JSObject();
                ret.put("cancelled", result.getData());
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void getAvailableModels(PluginCall call) {
        implementation.getAvailableModels(result -> {
            if (result.isSuccess()) {
                List<Map<String, Object>> data = result.getData();
                JSArray jsArray = convertListToJSArray(data);
                JSObject ret = new JSObject();
                ret.put("models", jsArray);
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void copyFile(PluginCall call) {
        String sourcePath = call.getString("sourcePath", "");
        String fileName = call.getString("fileName", "");

        implementation.copyFile(sourcePath, fileName, result -> {
            if (result.isSuccess()) {
                JSObject ret = new JSObject();
                ret.put("path", result.getData());
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void convertJsonSchemaToGrammar(PluginCall call) {
        String schema = call.getString("schema");
        if (schema == null) {
            call.reject("Schema parameter is required");
            return;
        }

        implementation.convertJsonSchemaToGrammar(schema, result -> {
            if (result.isSuccess()) {
                JSObject ret = new JSObject();
                ret.put("grammar", result.getData());
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    // MARK: - Utility Methods

    /**
     * Convert a Map to JSObject with proper handling of nested structures
     */
    private JSObject convertMapToJSObject(Map<String, Object> map) {
        JSObject jsObject = new JSObject();

        for (Map.Entry<String, Object> entry : map.entrySet()) {
            String key = entry.getKey();
            Object value = entry.getValue();

            if (value instanceof List<?>) {
                List<?> list = (List<?>) value;
                JSArray jsArray = new JSArray();
                for (Object item : list) {
                    if (item instanceof Map<?, ?>) {
                        @SuppressWarnings("unchecked")
                        Map<String, Object> itemMap = (Map<String, Object>) item;
                        jsArray.put(convertMapToJSObject(itemMap));
                    } else {
                        jsArray.put(item);
                    }
                }
                jsObject.put(key, jsArray);
            } else if (value instanceof Map<?, ?>) {
                @SuppressWarnings("unchecked")
                Map<String, Object> nestedMap = (Map<String, Object>) value;
                jsObject.put(key, convertMapToJSObject(nestedMap));
            } else {
                jsObject.put(key, value);
            }
        }

        return jsObject;
    }

    /**
     * Convert a List of Maps to JSArray
     */
    private JSArray convertListToJSArray(List<Map<String, Object>> list) {
        JSArray jsArray = new JSArray();

        for (Map<String, Object> item : list) {
            jsArray.put(convertMapToJSObject(item));
        }

        return jsArray;
    }

    // =========================================================================
    // MARK: - LlamaCpp Streaming API
    // =========================================================================

    /**
     * Initialize a LlamaCpp inference context for streaming.
     * 
     */
    /**
     * Initialize a LlamaCpp inference context for streaming.
     * 
     */
    @PluginMethod
    public void initSmolLM(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        String modelPath = call.getString("modelPath", "");
        String multimodalProj = call.getString("multimodalProj", ""); // Optional multimodal projector path
        JSObject params = call.getObject("params", new JSObject());

        if (modelPath == null || modelPath.isEmpty()) {
            call.reject("Model path is required");
            return;
        }

        // Synchronize to prevent race conditions during init
        synchronized (LlamaCppPlugin.class) {
            // Check if THIS specific model is already loaded in this slot
            String loadedPath = loadedModelPaths.get(contextId);
            LlamaCppInference existing = inferenceInstances.get(contextId);

            if (existing != null && loadedPath != null && loadedPath.equals(modelPath)) {
                Log.i(TAG, "🟢 Context " + contextId + " already has model " + modelPath + " loaded. Reusing...");

                JSObject result = new JSObject();
                result.put("contextId", contextId);
                result.put("success", true);
                result.put("architecture", "llamacpp");
                result.put("reused", true);
                call.resolve(result);
                return;
            }

            // If different model or not loaded, close existing
            if (existing != null) {
                Log.i(TAG,
                        "♻️ Context " + contextId + " has different model loaded (" + loadedPath + "). Unloading...");
                existing.close();
                inferenceInstances.remove(contextId);
                loadedModelPaths.remove(contextId);
            }

            try {
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
                        (multimodalProj.isEmpty() ? "" : " and projector: " + multimodalProj));

                // Pass multimodalProj to load
                inference.load(resolvedPath, multimodalProj, inferenceParams);

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

            } catch (Exception e) {
                Log.e(TAG, "Failed to initialize LlamaCpp inference: " + e.getMessage());
                call.reject("Failed to initialize LlamaCpp inference: " + e.getMessage());
            }
        }
    }

    /**
     * Generate a streaming response.
     * Emits tokens via Capacitor events as they are generated.
     */
    @PluginMethod
    public void streamingCompletion(PluginCall call) {
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
            Log.e(TAG, "❌ streamingCompletion: Empty prompt for contextId=" + contextId);
            call.reject("Prompt is required");
            return;
        }

        String[] images = new String[0];
        if (imagesArray.length() > 0) {
            try {
                List<String> imageList = new ArrayList<>();
                for (int i = 0; i < imagesArray.length(); i++) {
                    imageList.add(imagesArray.getString(i));
                }
                images = imageList.toArray(new String[0]);
            } catch (JSONException e) {
                Log.e(TAG, "Failed to parse images: " + e.getMessage());
            }
        }

        call.setKeepAlive(true);

        final StringBuilder tokenBuffer = new StringBuilder();
        final long[] lastEmitTime = {System.currentTimeMillis()};

        inference.getResponseStreaming(
                prompt,
                images,
                token -> {
                    synchronized(tokenBuffer) {
                        tokenBuffer.append(token);
                        long now = System.currentTimeMillis();
                        if (now - lastEmitTime[0] >= 100) {
                            String batched = tokenBuffer.toString();
                            tokenBuffer.setLength(0);
                            lastEmitTime[0] = now;
                            
                            JSObject tokenEvent = new JSObject();
                            tokenEvent.put("contextId", contextId);
                            tokenEvent.put("token", batched);
                            notifyListeners("smolLMToken", tokenEvent);
                        }
                    }
                },
                response -> {
                    synchronized(tokenBuffer) {
                        if (tokenBuffer.length() > 0) {
                            JSObject tokenEvent = new JSObject();
                            tokenEvent.put("contextId", contextId);
                            tokenEvent.put("token", tokenBuffer.toString());
                            notifyListeners("smolLMToken", tokenEvent);
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

    /**
     * Generate a complete response (blocking).
     */
    @PluginMethod
    public void smolLMCompletion(PluginCall call) {
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
                result.put("tokensPerSecond", inference.getResponseGenerationSpeed());
                result.put("contextUsed", inference.getContextLengthUsed());
                call.resolve(result);

            } catch (Exception e) {
                call.reject("Generation failed: " + e.getMessage());
            }
        }, "LlamaCpp-Completion").start();
    }

    /**
     * Add a message to the chat history.
     */
    @PluginMethod
    public void addSmolLMMessage(PluginCall call) {
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
     * Interrupt an ongoing generation.
     */
    @PluginMethod
    public void interruptSmolLM(PluginCall call) {
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
    @PluginMethod
    public void getSmolLMMetrics(PluginCall call) {
        int contextId = call.getInt("contextId", 0);

        LlamaCppInference inference = inferenceInstances.get(contextId);
        if (inference == null) {
            call.reject("LlamaCpp context not found");
            return;
        }

        JSObject result = new JSObject();
        result.put("tokensPerSecond", inference.getResponseGenerationSpeed());
        result.put("contextUsed", inference.getContextLengthUsed());
        result.put("isGenerating", inference.isGenerating());
        result.put("isLoaded", inference.isLoaded());
        result.put("modelPath", loadedModelPaths.get(contextId));
        result.put("messageCount", inference.getMessageCount());

        try {
            String metricsJson = inference.getMetrics();
            JSONObject metrics = new JSONObject(metricsJson);

            Iterator<String> keys = metrics.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                result.put(key, metrics.get(key));
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to parse detailed metrics: " + e.getMessage());
        }

        call.resolve(result);
    }

    /**
     * Resets the context (history and KV cache).
     */
    @PluginMethod
    public void resetSmolLMContext(PluginCall call) {
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
    @PluginMethod
    public void releaseSmolLM(PluginCall call) {
        int contextId = call.getInt("contextId", 0);

        synchronized (LlamaCppPlugin.class) {
            LlamaCppInference inference = inferenceInstances.remove(contextId);
            loadedModelPaths.remove(contextId);

            if (inference != null) {
                inference.close();
                Log.i(TAG, "LlamaCpp context " + contextId + " released");
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void saveKvCache(PluginCall call) {
        int slotId = call.getInt("slotId", 0);
        String serverUrl = call.getString("serverUrl", "http://127.0.0.1:8080");

        OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(5, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .build();

        Request request = new Request.Builder()
            .url(serverUrl + "/slots/" + slotId + "?action=save")
            .post(RequestBody.create("", null))
            .build();

        client.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call callReq, IOException e) {
                Log.e(TAG, "Failed to save llama slot: " + e.getMessage());
                call.reject("Failed to save llama slot: " + e.getMessage());
            }

            @Override
            public void onResponse(Call callReq, Response response) throws IOException {
                if (response.isSuccessful()) {
                    Log.i(TAG, "Successfully saved llama slot " + slotId);
                    JSObject ret = new JSObject();
                    ret.put("success", true);
                    call.resolve(ret);
                } else {
                    String errorBody = response.body() != null ? response.body().string() : "No error body";
                    Log.e(TAG, "Server returned error during save: " + response.code() + " - " + errorBody);
                    call.reject("Server returned error: " + response.code());
                }
                response.close();
            }
        });
    }

    @PluginMethod
    public void restoreKvCache(PluginCall call) {
        int slotId = call.getInt("slotId", 0);
        String serverUrl = call.getString("serverUrl", "http://127.0.0.1:8080");

        OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(5, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .build();

        Request request = new Request.Builder()
            .url(serverUrl + "/slots/" + slotId + "?action=restore")
            .post(RequestBody.create("", null))
            .build();

        client.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call callReq, IOException e) {
                Log.e(TAG, "Failed to restore llama slot: " + e.getMessage());
                call.reject("Failed to restore llama slot: " + e.getMessage());
            }

            @Override
            public void onResponse(Call callReq, Response response) throws IOException {
                if (response.isSuccessful()) {
                    Log.i(TAG, "Successfully restored llama slot " + slotId);
                    JSObject ret = new JSObject();
                    ret.put("success", true);
                    call.resolve(ret);
                } else {
                    String errorBody = response.body() != null ? response.body().string() : "No error body";
                    Log.e(TAG, "Server returned error during restore: " + response.code() + " - " + errorBody);
                    call.reject("Server returned error: " + response.code());
                }
                response.close();
            }
        });
    }

    @PluginMethod
    public void invalidateKvCache(PluginCall call) {
        // For llama.cpp server, invalidating means deleting the slot file or clearing the slot
        // Currently we'll just return success as the server handles slot management
        call.resolve(new JSObject().put("success", true));
    }

    /**
     * Release all contexts.
     */
    @PluginMethod
    public void releaseAllSmolLM(PluginCall call) {
        synchronized (LlamaCppPlugin.class) {
            for (LlamaCppInference inference : inferenceInstances.values()) {
                inference.close();
            }
            inferenceInstances.clear();
            loadedModelPaths.clear();
            Log.i(TAG, "All LlamaCpp contexts released");
        }
        call.resolve();
    }
}
