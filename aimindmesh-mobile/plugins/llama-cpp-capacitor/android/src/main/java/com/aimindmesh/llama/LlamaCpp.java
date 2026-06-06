package com.aimindmesh.llama;

import android.util.Log;
import com.getcapacitor.JSObject;
import java.util.HashMap;
import java.util.Map;
import java.util.Iterator;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import android.content.Context;
import android.os.Environment;
import android.net.Uri;
import android.database.Cursor;
import android.provider.OpenableColumns;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import android.os.Handler;
import android.os.Looper;

// MARK: - Result Types
class LlamaResult<T> {
    private final T data;
    private final LlamaError error;
    private final boolean isSuccess;

    private LlamaResult(T data, LlamaError error, boolean isSuccess) {
        this.data = data;
        this.error = error;
        this.isSuccess = isSuccess;
    }

    public static <T> LlamaResult<T> success(T data) {
        return new LlamaResult<>(data, null, true);
    }

    public static <T> LlamaResult<T> failure(LlamaError error) {
        return new LlamaResult<>(null, error, false);
    }

    public boolean isSuccess() {
        return isSuccess;
    }

    public T getData() {
        return data;
    }

    public LlamaError getError() {
        return error;
    }
}

class LlamaError extends Exception {
    public LlamaError(String message) {
        super(message);
    }
}

class DownloadStatus {
    public long totalBytes = 0;
    public long downloadedBytes = 0;
    public boolean completed = false;
    public boolean failed = false;
    public boolean cancelled = false;
    public String error = null;
    public String localPath = null;
}

// MARK: - Context Management
class LlamaContext {
    private final int id;
    private LlamaModel model;
    private boolean isMultimodalEnabled = false;
    private boolean isVocoderEnabled = false;
    private long nativeContextId = -1;

    public LlamaContext(int id) {
        this.id = id;
    }

    public int getId() {
        return id;
    }

    public LlamaModel getModel() {
        return model;
    }

    public void setModel(LlamaModel model) {
        this.model = model;
    }

    public boolean isMultimodalEnabled() {
        return isMultimodalEnabled;
    }

    public void setMultimodalEnabled(boolean multimodalEnabled) {
        isMultimodalEnabled = multimodalEnabled;
    }

    public boolean isVocoderEnabled() {
        return isVocoderEnabled;
    }

    public void setVocoderEnabled(boolean vocoderEnabled) {
        isVocoderEnabled = vocoderEnabled;
    }

    public long getNativeContextId() {
        return nativeContextId;
    }

    public void setNativeContextId(long nativeContextId) {
        this.nativeContextId = nativeContextId;
    }
}

class LlamaModel {
    private final String path;
    private final String desc;
    private final int size;
    private final int nEmbd;
    private final int nParams;
    private final ChatTemplates chatTemplates;
    private final Map<String, Object> metadata;

    public LlamaModel(String path, String desc, int size, int nEmbd, int nParams, ChatTemplates chatTemplates,
            Map<String, Object> metadata) {
        this.path = path;
        this.desc = desc;
        this.size = size;
        this.nEmbd = nEmbd;
        this.nParams = nParams;
        this.chatTemplates = chatTemplates;
        this.metadata = metadata;
    }

    public String getPath() {
        return path;
    }

    public String getDesc() {
        return desc;
    }

    public int getSize() {
        return size;
    }

    public int getNEmbd() {
        return nEmbd;
    }

    public int getNParams() {
        return nParams;
    }

    public ChatTemplates getChatTemplates() {
        return chatTemplates;
    }

    public Map<String, Object> getMetadata() {
        return metadata;
    }
}

class ChatTemplates {
    private final boolean llamaChat;
    private final MinjaTemplates minja;

    public ChatTemplates(boolean llamaChat, MinjaTemplates minja) {
        this.llamaChat = llamaChat;
        this.minja = minja;
    }

    public boolean isLlamaChat() {
        return llamaChat;
    }

    public MinjaTemplates getMinja() {
        return minja;
    }
}

class MinjaTemplates {
    private final boolean default_;
    private final MinjaCaps defaultCaps;
    private final boolean toolUse;
    private final MinjaCaps toolUseCaps;

    public MinjaTemplates(boolean default_, MinjaCaps defaultCaps, boolean toolUse, MinjaCaps toolUseCaps) {
        this.default_ = default_;
        this.defaultCaps = defaultCaps;
        this.toolUse = toolUse;
        this.toolUseCaps = toolUseCaps;
    }

    public boolean isDefault() {
        return default_;
    }

    public MinjaCaps getDefaultCaps() {
        return defaultCaps;
    }

    public boolean isToolUse() {
        return toolUse;
    }

    public MinjaCaps getToolUseCaps() {
        return toolUseCaps;
    }
}

class MinjaCaps {
    private final boolean tools;
    private final boolean toolCalls;
    private final boolean toolResponses;
    private final boolean systemRole;
    private final boolean parallelToolCalls;
    private final boolean toolCallId;

    public MinjaCaps(boolean tools, boolean toolCalls, boolean toolResponses, boolean systemRole,
            boolean parallelToolCalls, boolean toolCallId) {
        this.tools = tools;
        this.toolCalls = toolCalls;
        this.toolResponses = toolResponses;
        this.systemRole = systemRole;
        this.parallelToolCalls = parallelToolCalls;
        this.toolCallId = toolCallId;
    }

    public boolean isTools() {
        return tools;
    }

    public boolean isToolCalls() {
        return toolCalls;
    }

    public boolean isToolResponses() {
        return toolResponses;
    }

    public boolean isSystemRole() {
        return systemRole;
    }

    public boolean isParallelToolCalls() {
        return parallelToolCalls;
    }

    public boolean isToolCallId() {
        return toolCallId;
    }
}

// MARK: - Main Implementation
public class LlamaCpp {
    private static final String TAG = "LlamaCpp";
    private final Map<Integer, LlamaContext> contexts = new HashMap<>();
    private int contextCounter = 0;
    private int contextLimit = 10;
    private boolean nativeLogEnabled = false;
    private Context context;

    // Use a single-threaded executor for inference to avoid blocking main thread
    private final ExecutorService inferenceExecutor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // Track active downloads
    private final Map<String, DownloadStatus> activeDownloads = new ConcurrentHashMap<>();

    // Constructor to receive context
    public LlamaCpp(Context context) {
        this.context = context;
    }

    // Native method declarations
    private native long initContextNative(String modelPath, String[] searchPaths, JSObject params);

    private native void releaseContextNative(long nativeContextId);

    private native Map<String, Object> completionNative(long contextId, JSObject params);

    private native Map<String, Object> modelInfoNative(String modelPath);

    private native void stopCompletionNative(long contextId);

    private native String getFormattedChatNative(long contextId, String messages, String chatTemplate);

    private native boolean toggleNativeLogNative(boolean enabled);

    // Model download and management methods
    // Tokenization methods
    private native Map<String, Object> tokenizeNative(long contextId, String text, String[] imagePaths);

    private native String detokenizeNative(long contextId, int[] tokens);

    // Model download and management methods
    private native String downloadModelNative(String url, String filename);

    private native Map<String, Object> getDownloadProgressNative(String url);

    private native boolean cancelDownloadNative(String url);

    private native List<Map<String, Object>> getAvailableModelsNative();

    // Grammar utilities
    private native String convertJsonSchemaToGrammarNative(String schemaJson);

    static {
        try {

            // Detect the current architecture and load the appropriate library
            String arch = System.getProperty("os.arch");
            String abi = android.os.Build.SUPPORTED_ABIS[0]; // Get primary ABI
            String libraryName;

            // Map Android ABI to library name
            switch (abi) {
                case "arm64-v8a":
                    libraryName = "llama-cpp-arm64";
                    break;
                case "armeabi-v7a":
                    libraryName = "llama-cpp-armeabi";
                    break;
                case "x86":
                    libraryName = "llama-cpp-x86";
                    break;
                case "x86_64":
                    libraryName = "llama-cpp-x86_64";
                    break;
                default:
                    Log.w(TAG, "Unsupported ABI: " + abi + ", falling back to arm64-v8a");
                    libraryName = "llama-cpp-arm64";
                    break;
            }

            Log.i(TAG, "Loading native library for ABI: " + abi + " (library: " + libraryName + ")");
            System.loadLibrary(libraryName);
            Log.i(TAG, "Successfully loaded llama-cpp native library: " + libraryName);
        } catch (UnsatisfiedLinkError e) {
            Log.e(TAG, "Failed to load llama-cpp native library: " + e.getMessage());
            throw e;
        }
    }

    // MARK: - Core initialization and management

    public void toggleNativeLog(boolean enabled, LlamaCallback<Void> callback) {
        try {
            boolean result = toggleNativeLogNative(enabled);
            nativeLogEnabled = enabled;
            if (enabled) {
                Log.i(TAG, "Native logging enabled");
            } else {
                Log.i(TAG, "Native logging disabled");
            }
            callback.onResult(LlamaResult.success(null));
        } catch (Exception e) {
            callback.onResult(LlamaResult.failure(new LlamaError("Failed to toggle native log: " + e.getMessage())));
        }
    }

    public void setContextLimit(int limit, LlamaCallback<Void> callback) {
        contextLimit = limit;
        Log.i(TAG, "Context limit set to " + limit);
        callback.onResult(LlamaResult.success(null));
    }

    public void downloadModel(String url, String filename, String hfToken, LlamaCallback<String> callback) {
        try {
            Log.i(TAG, "Starting download of model: " + filename + " from: " + url);

            // Register download status
            DownloadStatus status = new DownloadStatus();
            activeDownloads.put(url, status);

            // Get local path (we still use the native helper for path resolution if needed,
            // but we can also just construct it here to be safe and consistent with Java
            // logic)
            // For now, let's trust downloadModelNative returns a valid path or just use
            // filesDir
            String localPath = new File(context.getFilesDir(), filename).getAbsolutePath();
            status.localPath = localPath;

            // Start download in background thread
            new Thread(() -> {
                try {
                    downloadFile(url, localPath, hfToken, callback);
                } catch (Exception e) {
                    Log.e(TAG, "Error in download thread: " + e.getMessage());
                    status.failed = true;
                    status.error = e.getMessage();
                    activeDownloads.put(url, status); // Update status
                    // callback is usually called ONCE with success/failure of the START.
                    // But here we are simulating "start was successful".
                }
            }).start();

            // Return the local path immediately so UI knows where it will be
            callback.onResult(LlamaResult.success(localPath));

        } catch (Exception e) {
            Log.e(TAG, "Error preparing download: " + e.getMessage());
            callback.onResult(LlamaResult.failure(new LlamaError("Download preparation failed: " + e.getMessage())));
        }
    }

    private void downloadFile(String url, String localPath, String hfToken, LlamaCallback<String> callback) {
        DownloadStatus status = activeDownloads.get(url);
        if (status == null)
            status = new DownloadStatus();

        try {
            HttpURLConnection connection = null;
            URL downloadUrl = new URL(url);
            int redirectCount = 0;

            // Loop to handle redirects
            while (redirectCount < 10) {
                connection = (HttpURLConnection) downloadUrl.openConnection();
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(30000);
                connection.setReadTimeout(0); // No timeout for large files

                // Add HF auth header if token provided
                if (hfToken != null && !hfToken.isEmpty()) {
                    connection.setRequestProperty("Authorization", "Bearer " + hfToken);
                }

                int responseCode = connection.getResponseCode();

                // Handle redirects
                if (responseCode == HttpURLConnection.HTTP_MOVED_PERM ||
                        responseCode == HttpURLConnection.HTTP_MOVED_TEMP ||
                        responseCode == 307 ||
                        responseCode == 308) {

                    String location = connection.getHeaderField("Location");
                    if (location != null) {
                        Log.i(TAG, "Redirecting to: " + location);
                        downloadUrl = new URL(location);
                        redirectCount++;
                        connection.disconnect();
                        continue; // try again with new URL
                    }
                }

                if (responseCode != HttpURLConnection.HTTP_OK) {
                    throw new IOException("HTTP error code: " + responseCode + " for URL: " + downloadUrl);
                }

                // If we get here, connection is good
                break;
            }

            if (connection == null)
                throw new IOException("Connection failed");

            long fileSize = connection.getContentLengthLong();
            status.totalBytes = fileSize;
            Log.i(TAG, "File size: " + fileSize + " bytes");

            try (InputStream inputStream = connection.getInputStream();
                    FileOutputStream outputStream = new FileOutputStream(localPath)) {

                byte[] buffer = new byte[8192];
                long downloadedBytes = 0;
                int bytesRead;

                while ((bytesRead = inputStream.read(buffer)) != -1) {
                    if (status.cancelled) {
                        break;
                    }

                    outputStream.write(buffer, 0, bytesRead);
                    downloadedBytes += bytesRead;
                    status.downloadedBytes = downloadedBytes;

                    // Log progress every 1MB
                    if (downloadedBytes % (1024 * 1024) == 0) {
                        double progress = fileSize > 0 ? (double) downloadedBytes / fileSize * 100 : 0;
                        Log.i(TAG, String.format("Download progress: %.1f%% (%d/%d bytes)",
                                progress, downloadedBytes, fileSize));
                    }
                }
            }

            if (status.cancelled) {
                Log.i(TAG, "Download cancelled: " + url);
                new File(localPath).delete();
                activeDownloads.remove(url);
                return;
            }

            // Verify download
            File downloadedFile = new File(localPath);
            if (downloadedFile.length() < 1024) {
                throw new IOException("Download too small (" + downloadedFile.length()
                        + " bytes). Likely invalid file or error page.");
            }

            Log.i(TAG, "Download completed successfully: " + localPath);
            status.completed = true;
            // No callback here, as we already returned success in downloadModel
            // The client polls getDownloadProgress to know when it's done.

        } catch (Exception e) {
            Log.e(TAG, "Download failed: " + e.getMessage());
            status.failed = true;
            status.error = e.getMessage();

            // Clean up partial file
            try {
                new File(localPath).delete();
            } catch (Exception ignored) {
            }
        }
    }

    public void getDownloadProgress(String url, LlamaCallback<Map<String, Object>> callback) {
        try {
            // Check Java status first
            DownloadStatus status = activeDownloads.get(url);
            if (status != null) {
                Map<String, Object> progress = new HashMap<>();
                progress.put("bytesDownloaded", status.downloadedBytes);
                progress.put("totalBytes", status.totalBytes);
                progress.put("completed", status.completed);
                progress.put("failed", status.failed);
                progress.put("cancelled", status.cancelled);
                progress.put("error", status.error);
                callback.onResult(LlamaResult.success(progress));

                // Cleanup if done
                if (status.completed || status.failed || status.cancelled) {
                    // Don't remove immediately so client can see the 'completed' state
                    // Ideally we remove it on next call or after timeout
                }
                return;
            }

            // Fallback to native (legacy)
            Map<String, Object> progress = getDownloadProgressNative(url);
            if (progress != null) {
                callback.onResult(LlamaResult.success(progress));
            } else {
                callback.onResult(LlamaResult.failure(new LlamaError("No download in progress for this URL")));
            }
        } catch (Exception e) {
            Log.e(TAG, "Error getting download progress: " + e.getMessage());
            callback.onResult(LlamaResult.failure(new LlamaError("Failed to get progress: " + e.getMessage())));
        }
    }

    public void cancelDownload(String url, LlamaCallback<Boolean> callback) {
        try {
            DownloadStatus status = activeDownloads.get(url);
            if (status != null) {
                status.cancelled = true;
                callback.onResult(LlamaResult.success(true));
            } else {
                boolean cancelled = cancelDownloadNative(url);
                callback.onResult(LlamaResult.success(cancelled));
            }
        } catch (Exception e) {
            Log.e(TAG, "Error cancelling download: " + e.getMessage());
            callback.onResult(LlamaResult.failure(new LlamaError("Cancel failed: " + e.getMessage())));
        }
    }

    public void copyFile(String sourcePath, String fileName, LlamaCallback<String> callback) {
        try {
            Log.i(TAG, "Copying file: " + sourcePath + " to " + fileName);

            // Get the target path in files directory (root of Directory.Data)
            File targetFile = new File(context.getFilesDir(), fileName);

            InputStream inputStream = null;
            long totalBytes = 0;

            // Handle content:// URIs
            if (sourcePath.startsWith("content://")) {
                Uri uri = Uri.parse(sourcePath);
                inputStream = context.getContentResolver().openInputStream(uri);

                // Try to get file size
                try (Cursor cursor = context.getContentResolver().query(uri, null, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) {
                        int sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE);
                        if (sizeIndex != -1) {
                            totalBytes = cursor.getLong(sizeIndex);
                        }
                    }
                }
            } else {
                // Handle normal file paths
                File sourceFile = new File(sourcePath);
                if (!sourceFile.exists()) {
                    // Try removing file:// prefix if present
                    if (sourcePath.startsWith("file://")) {
                        sourceFile = new File(sourcePath.substring(7));
                    }
                }

                if (!sourceFile.exists()) {
                    throw new IOException("Source file does not exist: " + sourcePath);
                }

                inputStream = new FileInputStream(sourceFile);
                totalBytes = sourceFile.length();
            }

            if (inputStream == null) {
                throw new IOException("Failed to open input stream for: " + sourcePath);
            }

            // Copy file in chunks to avoid OOM
            try (InputStream fis = inputStream;
                    FileOutputStream fos = new FileOutputStream(targetFile)) {

                byte[] buffer = new byte[10000000]; // 10MB buffer
                int bytesRead;
                long copiedBytes = 0;

                while ((bytesRead = fis.read(buffer)) != -1) {
                    fos.write(buffer, 0, bytesRead);
                    copiedBytes += bytesRead;

                    // Log progress every 10MB
                    if (totalBytes > 0 && copiedBytes % (10 * 1024 * 1024) == 0) {
                        double progress = (double) copiedBytes / totalBytes * 100;
                        Log.i(TAG, String.format("Copy progress: %.1f%% (%d/%d bytes)",
                                progress, copiedBytes, totalBytes));
                    }
                }
            }

            Log.i(TAG, "File copied successfully to: " + targetFile.getAbsolutePath());
            callback.onResult(LlamaResult.success(targetFile.getAbsolutePath()));

        } catch (Exception e) {
            Log.e(TAG, "File copy failed: " + e.getMessage());
            callback.onResult(LlamaResult.failure(new LlamaError("File copy failed: " + e.getMessage())));
        }
    }

    public void getAvailableModels(LlamaCallback<List<Map<String, Object>>> callback) {
        try {
            List<Map<String, Object>> models = getAvailableModelsNative();
            callback.onResult(LlamaResult.success(models));
        } catch (Exception e) {
            Log.e(TAG, "Error getting available models: " + e.getMessage());
            callback.onResult(LlamaResult.failure(new LlamaError("Failed to get models: " + e.getMessage())));
        }
    }

    public void convertJsonSchemaToGrammar(String schemaJson, LlamaCallback<String> callback) {
        try {
            String grammar = convertJsonSchemaToGrammarNative(schemaJson);
            callback.onResult(LlamaResult.success(grammar));
        } catch (Exception e) {
            Log.e(TAG, "Error converting JSON schema to grammar: " + e.getMessage());
            callback.onResult(LlamaResult.failure(new LlamaError("Failed to convert schema: " + e.getMessage())));
        }
    }

    public void modelInfo(String path, String[] skip, LlamaCallback<Map<String, Object>> callback) {
        try {
            // Call native method to get actual model info
            Map<String, Object> modelInfo = modelInfoNative(path);
            if (modelInfo != null) {
                callback.onResult(LlamaResult.success(modelInfo));
            } else {
                // Fallback to basic info if native method fails
                Map<String, Object> fallbackInfo = new HashMap<>();
                fallbackInfo.put("path", path);
                fallbackInfo.put("desc", "Model file found but info unavailable");
                fallbackInfo.put("size", 0);
                fallbackInfo.put("nEmbd", 0);
                fallbackInfo.put("nParams", 0);
                callback.onResult(LlamaResult.success(fallbackInfo));
            }
        } catch (Exception e) {
            Log.e(TAG, "Error getting model info: " + e.getMessage());
            // Return error info
            Map<String, Object> errorInfo = new HashMap<>();
            errorInfo.put("path", path);
            errorInfo.put("desc", "Error reading model: " + e.getMessage());
            errorInfo.put("size", 0);
            errorInfo.put("nEmbd", 0);
            errorInfo.put("nParams", 0);
            callback.onResult(LlamaResult.success(errorInfo));
        }
    }

    public void initContext(int contextId, JSObject params, LlamaCallback<Map<String, Object>> callback) {
        // Check context limit
        if (contexts.size() >= contextLimit) {
            callback.onResult(LlamaResult.failure(new LlamaError("Context limit reached")));
            return;
        }

        try {
            // Extract parameters
            String modelPath = params.getString("model", "");
            if (modelPath == null || modelPath.isEmpty()) {
                callback.onResult(LlamaResult.failure(new LlamaError("Model path is required")));
                return;
            }

            String filename = new File(modelPath).getName();

            // Get dynamic search paths
            String[] searchPaths = getModelSearchPaths(filename);

            // Call native initialization
            long nativeContextId = initContextNative(modelPath, searchPaths, params);
            if (nativeContextId < 0) {
                callback.onResult(LlamaResult.failure(new LlamaError("Failed to initialize native context")));
                return;
            }

            // Create Java context wrapper
            LlamaContext context = new LlamaContext(contextId);
            context.setNativeContextId(nativeContextId);
            contexts.put(contextId, context);

            // Return context info
            Map<String, Object> contextInfo = new HashMap<>();
            contextInfo.put("contextId", contextId);
            contextInfo.put("gpu", false);
            contextInfo.put("reasonNoGPU", "Currently not supported");

            Map<String, Object> modelInfo = new HashMap<>();
            modelInfo.put("desc", "Loaded model");
            modelInfo.put("size", 0);
            modelInfo.put("nEmbd", 0);
            modelInfo.put("nParams", 0);
            modelInfo.put("path", modelPath);

            contextInfo.put("model", modelInfo);
            contextInfo.put("androidLib", "llama-cpp");

            callback.onResult(LlamaResult.success(contextInfo));

        } catch (Exception e) {
            callback.onResult(LlamaResult.failure(new LlamaError("Context initialization failed: " + e.getMessage())));
        }
    }

    public void releaseContext(int contextId, LlamaCallback<Void> callback) {
        LlamaContext context = contexts.get(contextId);
        if (context == null) {
            callback.onResult(LlamaResult.failure(new LlamaError("Context not found")));
            return;
        }

        try {
            // Release native context
            if (context.getNativeContextId() >= 0) {
                releaseContextNative(context.getNativeContextId());
            }

            // Remove from Java context map
            contexts.remove(contextId);

            callback.onResult(LlamaResult.success(null));

        } catch (Exception e) {
            callback.onResult(LlamaResult.failure(new LlamaError("Failed to release context: " + e.getMessage())));
        }
    }

    public void releaseAllContexts(LlamaCallback<Void> callback) {
        contexts.clear();
        callback.onResult(LlamaResult.success(null));
    }

    // MARK: - Chat and completion

    public void getFormattedChat(int contextId, String messages, String chatTemplate, JSObject params,
            LlamaCallback<Map<String, Object>> callback) {
        LlamaContext context = contexts.get(contextId);
        if (context == null) {
            callback.onResult(LlamaResult.failure(new LlamaError("Context not found")));
            return;
        }

        try {
            // Call native formatted chat
            String result = getFormattedChatNative(context.getNativeContextId(), messages, chatTemplate);

            // Build formatted chat result - use Lists instead of arrays
            Map<String, Object> formattedChat = new HashMap<>();
            formattedChat.put("type", "llama-chat");
            formattedChat.put("prompt", result);
            formattedChat.put("has_media", false);
            formattedChat.put("media_paths", new ArrayList<String>());

            callback.onResult(LlamaResult.success(formattedChat));

        } catch (Exception e) {
            callback.onResult(LlamaResult.failure(new LlamaError("Failed to format chat: " + e.getMessage())));
        }
    }

    public void completion(int contextId, JSObject params, LlamaCallback<Map<String, Object>> callback) {
        LlamaContext context = contexts.get(contextId);
        if (context == null) {
            callback.onResult(LlamaResult.failure(new LlamaError("Context not found")));
            return;
        }

        final long nativeContextId = context.getNativeContextId();

        // Run inference on background thread to avoid blocking main UI thread
        inferenceExecutor.execute(() -> {
            try {
                Log.i(TAG, "Starting completion for context: " + contextId + " on background thread");

                // Call native completion with full params
                Map<String, Object> result = completionNative(nativeContextId, params);

                // Deliver result directly - Capacitor handles thread routing
                if (result != null) {
                    Log.i(TAG, "Completion completed successfully");
                    callback.onResult(LlamaResult.success(result));
                } else {
                    Log.e(TAG, "Completion returned null result");
                    callback.onResult(LlamaResult.failure(new LlamaError("Completion failed")));
                }

            } catch (Exception e) {
                callback.onResult(LlamaResult.failure(new LlamaError("Completion failed: " + e.getMessage())));
            }
        });
    }

    public void stopCompletion(int contextId, LlamaCallback<Void> callback) {
        LlamaContext context = contexts.get(contextId);
        if (context == null) {
            callback.onResult(LlamaResult.failure(new LlamaError("Context not found")));
            return;
        }

        try {
            stopCompletionNative(context.getNativeContextId());
            callback.onResult(LlamaResult.success(null));
        } catch (Exception e) {
            callback.onResult(LlamaResult.failure(new LlamaError("Failed to stop completion: " + e.getMessage())));
        }
    }

    // MARK: - Chat-first methods (like llama-cli -sys)

    public void chat(int contextId, String messagesJson, String system, String chatTemplate, JSObject params,
            LlamaCallback<Map<String, Object>> callback) {
        LlamaContext context = contexts.get(contextId);
        if (context == null) {
            callback.onResult(LlamaResult.failure(new LlamaError("Context not found")));
            return;
        }

        final long nativeContextId = context.getNativeContextId();

        // Run on background thread to avoid blocking UI
        inferenceExecutor.execute(() -> {
            try {
                Log.i(TAG, "Starting chat for context: " + contextId + " on background thread");

                // Parse messages JSON
                List<Map<String, Object>> messages = parseMessagesJson(messagesJson);

                // Add system message if provided
                if (system != null && !system.isEmpty()) {
                    Map<String, Object> systemMsg = new HashMap<>();
                    systemMsg.put("role", "system");
                    systemMsg.put("content", system);
                    messages.add(0, systemMsg);
                }

                // Convert messages to JSON string for getFormattedChat
                String formattedMessages = convertMessagesToJson(messages);

                // First, format the chat
                String formattedPrompt = getFormattedChatNative(nativeContextId, formattedMessages,
                        chatTemplate != null ? chatTemplate : "");

                // Then run completion with the formatted prompt
                JSObject completionParams = new JSObject();
                completionParams.put("prompt", formattedPrompt);

                // Copy other parameters from params
                if (params != null) {
                    Iterator<String> keyIterator = params.keys();
                    while (keyIterator.hasNext()) {
                        String key = keyIterator.next();
                        if (!key.equals("prompt") && !key.equals("messages")) {
                            completionParams.put(key, params.get(key));
                        }
                    }
                }

                // Call native completion
                Map<String, Object> result = completionNative(nativeContextId, completionParams);

                // Deliver result directly - Capacitor handles thread routing
                if (result != null) {
                    Log.i(TAG, "Chat completed successfully");
                    callback.onResult(LlamaResult.success(result));
                } else {
                    Log.e(TAG, "Chat returned null result");
                    callback.onResult(LlamaResult.failure(new LlamaError("Chat failed")));
                }

            } catch (Exception e) {
                Log.e(TAG, "Chat failed: " + e.getMessage());
                callback.onResult(LlamaResult.failure(new LlamaError("Chat failed: " + e.getMessage())));
            }
        });
    }

    public void chatWithSystem(int contextId, String system, String message, JSObject params,
            LlamaCallback<Map<String, Object>> callback) {
        try {
            // Create a simple message array
            List<Map<String, Object>> messages = new ArrayList<>();
            Map<String, Object> userMsg = new HashMap<>();
            userMsg.put("role", "user");
            userMsg.put("content", message);
            messages.add(userMsg);

            // Call the main chat method
            chat(contextId, convertMessagesToJson(messages), system, null, params, callback);
        } catch (Exception e) {
            callback.onResult(LlamaResult.failure(new LlamaError("Chat with system failed: " + e.getMessage())));
        }
    }

    public void generateText(int contextId, String prompt, JSObject params,
            LlamaCallback<Map<String, Object>> callback) {
        LlamaContext context = contexts.get(contextId);
        if (context == null) {
            callback.onResult(LlamaResult.failure(new LlamaError("Context not found")));
            return;
        }

        final long nativeContextId = context.getNativeContextId();

        // Run on background thread to avoid blocking UI
        inferenceExecutor.execute(() -> {
            try {
                Log.i(TAG, "Starting text generation for context: " + contextId + " on background thread");

                // Create completion parameters
                JSObject completionParams = new JSObject();
                completionParams.put("prompt", prompt);

                // Copy other parameters from params
                if (params != null) {
                    Iterator<String> keyIterator = params.keys();
                    while (keyIterator.hasNext()) {
                        String key = keyIterator.next();
                        if (!key.equals("prompt") && !key.equals("messages")) {
                            completionParams.put(key, params.get(key));
                        }
                    }
                }

                // Call native completion
                Map<String, Object> result = completionNative(nativeContextId, completionParams);

                // Deliver result directly - Capacitor handles thread routing
                if (result != null) {
                    Log.i(TAG, "Text generation completed successfully");
                    callback.onResult(LlamaResult.success(result));
                } else {
                    Log.e(TAG, "Text generation returned null result");
                    callback.onResult(LlamaResult.failure(new LlamaError("Text generation failed")));
                }

            } catch (Exception e) {
                Log.e(TAG, "Text generation failed: " + e.getMessage());
                callback.onResult(LlamaResult.failure(new LlamaError("Text generation failed: " + e.getMessage())));
            }
        });
    }

    // Helper methods for message handling
    private List<Map<String, Object>> parseMessagesJson(String messagesJson) {
        List<Map<String, Object>> messages = new ArrayList<>();
        try {
            // Parse JSON string to extract messages
            org.json.JSONArray jsonArray = new org.json.JSONArray(messagesJson);
            for (int i = 0; i < jsonArray.length(); i++) {
                org.json.JSONObject jsonMessage = jsonArray.getJSONObject(i);
                Map<String, Object> message = new HashMap<>();
                message.put("role", jsonMessage.getString("role"));
                message.put("content", jsonMessage.getString("content"));
                messages.add(message);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error parsing messages JSON: " + e.getMessage());
            // Return empty list on error
        }
        return messages;
    }

    private String convertMessagesToJson(List<Map<String, Object>> messages) {
        try {
            org.json.JSONArray jsonArray = new org.json.JSONArray();
            for (Map<String, Object> message : messages) {
                org.json.JSONObject jsonMessage = new org.json.JSONObject();
                jsonMessage.put("role", message.get("role"));
                jsonMessage.put("content", message.get("content"));
                jsonArray.put(jsonMessage);
            }
            return jsonArray.toString();
        } catch (Exception e) {
            Log.e(TAG, "Error converting messages to JSON: " + e.getMessage());
            return "[]"; // Return empty array on error
        }
    }

    // MARK: - Session management

    public void loadSession(int contextId, String filepath, LlamaCallback<Map<String, Object>> callback) {
        if (contexts.get(contextId) == null) {
            callback.onResult(LlamaResult.failure(new LlamaError("Context not found")));
            return;
        }

        // This would typically load session from file
        Map<String, Object> sessionResult = new HashMap<>();
        sessionResult.put("tokens_loaded", 0);
        sessionResult.put("prompt", "");

        callback.onResult(LlamaResult.success(sessionResult));
    }

    public void saveSession(int contextId, String filepath, int size, LlamaCallback<Integer> callback) {
        if (contexts.get(contextId) == null) {
            callback.onResult(LlamaResult.failure(new LlamaError("Context not found")));
            return;
        }

        // This would typically save session to file
        callback.onResult(LlamaResult.success(0));
    }

    // MARK: - Tokenization

    public void tokenize(int contextId, String text, String[] imagePaths, LlamaCallback<Map<String, Object>> callback) {
        LlamaContext context = contexts.get(contextId);
        if (context == null) {
            callback.onResult(LlamaResult.failure(new LlamaError("Context not found")));
            return;
        }

        try {
            Log.i(TAG, "Tokenizing text: " + text);

            // Call native tokenization
            Map<String, Object> result = tokenizeNative(context.getNativeContextId(), text, imagePaths);

            if (result != null) {
                Log.i(TAG, "Tokenization completed successfully");
                callback.onResult(LlamaResult.success(result));
            } else {
                Log.e(TAG, "Tokenization returned null result");
                callback.onResult(LlamaResult.failure(new LlamaError("Tokenization failed")));
            }

        } catch (Exception e) {
            Log.e(TAG, "Tokenization failed: " + e.getMessage());
            callback.onResult(LlamaResult.failure(new LlamaError("Tokenization failed: " + e.getMessage())));
        }
    }

    public void detokenize(int contextId, Integer[] tokens, LlamaCallback<String> callback) {
        LlamaContext context = contexts.get(contextId);
        if (context == null) {
            callback.onResult(LlamaResult.failure(new LlamaError("Context not found")));
            return;
        }

        try {
            // Convert Integer[] to int[]
            int[] tokenArray = new int[tokens.length];
            for (int i = 0; i < tokens.length; i++) {
                tokenArray[i] = tokens[i];
            }

            String result = detokenizeNative(context.getNativeContextId(), tokenArray);
            callback.onResult(LlamaResult.success(result));

        } catch (Exception e) {
            Log.e(TAG, "Detokenization failed: " + e.getMessage());
            callback.onResult(LlamaResult.failure(new LlamaError("Detokenization failed: " + e.getMessage())));
        }
    }

    // MARK: - Embeddings and reranking

    public void embedding(int contextId, String text, JSObject params, LlamaCallback<Map<String, Object>> callback) {
        if (contexts.get(contextId) == null) {
            callback.onResult(LlamaResult.failure(new LlamaError("Context not found")));
            return;
        }

        // Fixed: Use List instead of array for proper JSON serialization
        Map<String, Object> embeddingResult = new HashMap<>();
        List<Double> embeddingList = new ArrayList<>();

        // Generate mock embedding vector
        for (int i = 0; i < 384; i++) {
            embeddingList.add(Math.random() - 0.5);
        }

        embeddingResult.put("embedding", embeddingList);

        callback.onResult(LlamaResult.success(embeddingResult));
    }

    public void rerank(int contextId, String query, String[] documents, JSObject params,
            LlamaCallback<List<Map<String, Object>>> callback) {
        if (contexts.get(contextId) == null) {
            callback.onResult(LlamaResult.failure(new LlamaError("Context not found")));
            return;
        }

        // Fixed: Use List instead of array for proper JSON serialization
        List<Map<String, Object>> rerankResults = new ArrayList<>();

        // Generate mock rerank results
        for (int i = 0; i < documents.length; i++) {
            Map<String, Object> result = new HashMap<>();
            result.put("score", Math.random());
            result.put("index", i);
            rerankResults.add(result);
        }

        callback.onResult(LlamaResult.success(rerankResults));
    }

    // MARK: - Benchmarking

    public void bench(int contextId, int pp, int tg, int pl, int nr, LlamaCallback<String> callback) {
        if (contexts.get(contextId) == null) {
            callback.onResult(LlamaResult.failure(new LlamaError("Context not found")));
            return;
        }

        // This would typically run benchmarks
        String benchResult = "[]";
        callback.onResult(LlamaResult.success(benchResult));
    }

    // MARK: - LoRA adapters

    public void applyLoraAdapters(int contextId, List<Map<String, Object>> loraAdapters, LlamaCallback<Void> callback) {
        if (contexts.get(contextId) == null) {
            callback.onResult(LlamaResult.failure(new LlamaError("Context not found")));
            return;
        }

        // This would typically apply LoRA adapters
        callback.onResult(LlamaResult.success(null));
    }

    public void removeLoraAdapters(int contextId, LlamaCallback<Void> callback) {
        if (contexts.get(contextId) == null) {
            callback.onResult(LlamaResult.failure(new LlamaError("Context not found")));
            return;
        }

        // This would typically remove LoRA adapters
        callback.onResult(LlamaResult.success(null));
    }

    public void getLoadedLoraAdapters(int contextId, LlamaCallback<List<Map<String, Object>>> callback) {
        if (contexts.get(contextId) == null) {
            callback.onResult(LlamaResult.failure(new LlamaError("Context not found")));
            return;
        }

        // Fixed: Use List instead of array for proper JSON serialization
        List<Map<String, Object>> adapters = new ArrayList<>();
        callback.onResult(LlamaResult.success(adapters));
    }

    // MARK: - Multimodal methods

    public void initMultimodal(int contextId, String path, boolean useGpu, LlamaCallback<Boolean> callback) {
        LlamaContext context = contexts.get(contextId);
        if (context == null) {
            callback.onResult(LlamaResult.failure(new LlamaError("Context not found")));
            return;
        }

        context.setMultimodalEnabled(true);
        callback.onResult(LlamaResult.success(true));
    }

    public void isMultimodalEnabled(int contextId, LlamaCallback<Boolean> callback) {
        LlamaContext context = contexts.get(contextId);
        if (context == null) {
            callback.onResult(LlamaResult.failure(new LlamaError("Context not found")));
            return;
        }

        callback.onResult(LlamaResult.success(context.isMultimodalEnabled()));
    }

    public void getMultimodalSupport(int contextId, LlamaCallback<Map<String, Object>> callback) {
        if (contexts.get(contextId) == null) {
            callback.onResult(LlamaResult.failure(new LlamaError("Context not found")));
            return;
        }

        Map<String, Object> support = new HashMap<>();
        support.put("vision", true);
        support.put("audio", true);

        callback.onResult(LlamaResult.success(support));
    }

    public void releaseMultimodal(int contextId, LlamaCallback<Void> callback) {
        LlamaContext context = contexts.get(contextId);
        if (context == null) {
            callback.onResult(LlamaResult.failure(new LlamaError("Context not found")));
            return;
        }

        context.setMultimodalEnabled(false);
        callback.onResult(LlamaResult.success(null));
    }

    // MARK: - TTS methods

    public void initVocoder(int contextId, String path, Integer nBatch, LlamaCallback<Boolean> callback) {
        LlamaContext context = contexts.get(contextId);
        if (context == null) {
            callback.onResult(LlamaResult.failure(new LlamaError("Context not found")));
            return;
        }

        context.setVocoderEnabled(true);
        callback.onResult(LlamaResult.success(true));
    }

    public void isVocoderEnabled(int contextId, LlamaCallback<Boolean> callback) {
        LlamaContext context = contexts.get(contextId);
        if (context == null) {
            callback.onResult(LlamaResult.failure(new LlamaError("Context not found")));
            return;
        }

        callback.onResult(LlamaResult.success(context.isVocoderEnabled()));
    }

    public void getFormattedAudioCompletion(int contextId, String speakerJsonStr, String textToSpeak,
            LlamaCallback<Map<String, Object>> callback) {
        if (contexts.get(contextId) == null) {
            callback.onResult(LlamaResult.failure(new LlamaError("Context not found")));
            return;
        }

        Map<String, Object> audioCompletion = new HashMap<>();
        audioCompletion.put("prompt", "");
        audioCompletion.put("grammar", null);

        callback.onResult(LlamaResult.success(audioCompletion));
    }

    public void getAudioCompletionGuideTokens(int contextId, String textToSpeak,
            LlamaCallback<List<Integer>> callback) {
        if (contexts.get(contextId) == null) {
            callback.onResult(LlamaResult.failure(new LlamaError("Context not found")));
            return;
        }

        // Fixed: Use List instead of array for proper JSON serialization
        List<Integer> tokens = new ArrayList<>();
        callback.onResult(LlamaResult.success(tokens));
    }

    public void decodeAudioTokens(int contextId, Integer[] tokens, LlamaCallback<List<Integer>> callback) {
        if (contexts.get(contextId) == null) {
            callback.onResult(LlamaResult.failure(new LlamaError("Context not found")));
            return;
        }

        // Fixed: Use List instead of array for proper JSON serialization
        List<Integer> decodedTokens = new ArrayList<>();
        callback.onResult(LlamaResult.success(decodedTokens));
    }

    public void releaseVocoder(int contextId, LlamaCallback<Void> callback) {
        LlamaContext context = contexts.get(contextId);
        if (context == null) {
            callback.onResult(LlamaResult.failure(new LlamaError("Context not found")));
            return;
        }

        context.setVocoderEnabled(false);
        callback.onResult(LlamaResult.success(null));
    }

    // MARK: - Callback Interface
    public interface LlamaCallback<T> {
        void onResult(LlamaResult<T> result);
    }

    // Add this method to get proper storage paths
    private String[] getModelSearchPaths(String filename) {
        String packageName = context.getPackageName();

        List<String> paths = new ArrayList<>();

        // Internal storage (always available, no permissions needed)
        File internalFilesDir = context.getFilesDir();
        paths.add(internalFilesDir.getAbsolutePath() + "/" + filename);
        paths.add(internalFilesDir.getAbsolutePath() + "/Documents/" + filename);

        // External files directory (app-specific, no permissions needed on Android 10+)
        File externalFilesDir = context.getExternalFilesDir(null);
        if (externalFilesDir != null) {
            paths.add(externalFilesDir.getAbsolutePath() + "/" + filename);
            paths.add(externalFilesDir.getAbsolutePath() + "/Documents/" + filename);
        }

        // External storage (requires permissions, may not be available)
        if (Environment.getExternalStorageState().equals(Environment.MEDIA_MOUNTED)) {
            File externalStorage = Environment.getExternalStorageDirectory();
            paths.add(externalStorage.getAbsolutePath() + "/Documents/" + filename);
            paths.add(externalStorage.getAbsolutePath() + "/Download/" + filename);
            paths.add(externalStorage.getAbsolutePath() + "/Downloads/" + filename);
            paths.add(externalStorage.getAbsolutePath() + "/Downloads/models/" + filename);
        }

        return paths.toArray(new String[0]);
    }

    /**
     * Resolves a model path by searching through common directories.
     * Returns the first path where the file exists.
     * 
     * @param modelPath The model path (can be just filename or full path)
     * @return The resolved absolute path to the model file
     */
    public String resolveModelPath(String modelPath) {
        // If path already exists, return it
        File directFile = new File(modelPath);
        if (directFile.exists()) {
            return modelPath;
        }

        // Extract filename and search in common paths
        String filename = directFile.getName();
        String[] searchPaths = getModelSearchPaths(filename);

        for (String path : searchPaths) {
            File file = new File(path);
            if (file.exists()) {
                Log.i(TAG, "Resolved model path: " + path);
                return path;
            }
        }

        // Fallback to internal files directory
        File fallback = new File(context.getFilesDir(), filename);
        Log.w(TAG, "Model not found in any search path, using fallback: " + fallback.getAbsolutePath());
        return fallback.getAbsolutePath();
    }
}
