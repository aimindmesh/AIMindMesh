package com.aimindmesh.piper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Piper")
public class PiperPlugin extends Plugin {

    private PiperSynthesizer synthesizer;

    @Override
    public void load() {
        synthesizer = new PiperSynthesizer(getContext());
    }

    @PluginMethod
    public void loadVoice(PluginCall call) {
        String modelPath = call.getString("modelPath");
        String configPath = call.getString("configPath");

        if (modelPath == null || configPath == null) {
            call.reject("Model path and config path are required");
            return;
        }

        new Thread(() -> {
            try {
                android.util.Log.i("PiperPlugin",
                        "Calling synthesizer.loadVoice on thread: " + Thread.currentThread().getName());
                boolean success = synthesizer.loadVoice(modelPath, configPath);
                android.util.Log.i("PiperPlugin", "synthesizer.loadVoice returned: " + success);
                if (success) {
                    call.resolve();
                } else {
                    call.reject("Failed to load voice - files not found or invalid");
                }
            } catch (Exception e) {
                call.reject("Error loading voice: " + e.getMessage(), e);
            }
        }).start();
    }

    @PluginMethod
    public void unloadVoice(PluginCall call) {
        synthesizer.unloadVoice();
        call.resolve();
    }

    @PluginMethod
    public void synthesize(PluginCall call) {
        com.getcapacitor.JSArray jsPhonemes = call.getArray("phonemeIds");
        if (jsPhonemes == null) {
            call.reject("phonemeIds is required");
            return;
        }

        new Thread(() -> {
            try {
                long[] phonemeIds = new long[jsPhonemes.length()];
                for (int i = 0; i < jsPhonemes.length(); i++) {
                    phonemeIds[i] = jsPhonemes.getLong(i);
                }

                String audioPath = synthesizer.synthesize(phonemeIds);
                if (audioPath != null) {
                    JSObject ret = new JSObject();
                    ret.put("audioPath", audioPath);
                    call.resolve(ret);
                } else {
                    call.reject("Failed to synthesize text");
                }
            } catch (Exception e) {
                call.reject("Error synthesizing text: " + e.getMessage(), e);
            }
        }).start();
    }

    @PluginMethod
    public void speak(PluginCall call) {
        com.getcapacitor.JSArray jsPhonemes = call.getArray("phonemeIds");
        android.util.Log.i("PiperPlugin",
                "speak method called with phonemes count: " + (jsPhonemes != null ? jsPhonemes.length() : "null"));

        if (jsPhonemes == null) {
            call.reject("phonemeIds is required");
            return;
        }

        new Thread(() -> {
            try {
                long[] phonemeIds = new long[jsPhonemes.length()];
                for (int i = 0; i < jsPhonemes.length(); i++) {
                    phonemeIds[i] = jsPhonemes.getLong(i);
                }

                android.util.Log.i("PiperPlugin", "speak thread started");
                // CRITICAL: Pass callback to wait for audio completion
                synthesizer.speak(phonemeIds, () -> {
                    android.util.Log.i("PiperPlugin", "Audio playback completed, resolving call");
                    call.resolve();
                });
            } catch (Exception e) {
                android.util.Log.e("PiperPlugin", "speak error", e);
                call.reject("Error speaking text: " + e.getMessage(), e);
            }
        }).start();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        synthesizer.stop();
        call.resolve();
    }

    @PluginMethod
    public void isVoiceLoaded(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("loaded", synthesizer.isVoiceLoaded());
        call.resolve(ret);
    }

    @PluginMethod
    public void setAudioOutput(PluginCall call) {
        String output = call.getString("output");
        if (output == null) {
            call.reject("Output type is required");
            return;
        }
        synthesizer.setAudioOutput(output);
        call.resolve();
    }

    @PluginMethod
    public void getAvailableAudioOutputs(PluginCall call) {
        java.util.List<String> outputs = synthesizer.getAvailableAudioOutputs();
        JSObject ret = new JSObject();
        com.getcapacitor.JSArray jsOutputs = new com.getcapacitor.JSArray();
        for (String output : outputs) {
            jsOutputs.put(output);
        }
        ret.put("outputs", jsOutputs);
        call.resolve(ret);
    }

    @PluginMethod
    public void downloadVoice(PluginCall call) {
        String url = call.getString("url");
        String path = call.getString("path");

        if (url == null || path == null) {
            call.reject("Missing url or path");
            return;
        }

        new Thread(() -> {
            try {
                java.net.URL downloadUrl = new java.net.URL(url);
                java.net.HttpURLConnection connection = (java.net.HttpURLConnection) downloadUrl.openConnection();
                connection.connect();

                if (connection.getResponseCode() != java.net.HttpURLConnection.HTTP_OK) {
                    call.reject("Server returned HTTP " + connection.getResponseCode() + " "
                            + connection.getResponseMessage());
                    return;
                }

                int fileLength = connection.getContentLength();
                java.io.InputStream input = new java.io.BufferedInputStream(downloadUrl.openStream());

                java.io.File file = new java.io.File(getContext().getFilesDir(), path);
                file.getParentFile().mkdirs();

                java.io.OutputStream output = new java.io.FileOutputStream(file);

                byte[] data = new byte[4096];
                long total = 0;
                int count;
                int lastProgress = 0;

                while ((count = input.read(data)) != -1) {
                    total += count;
                    if (fileLength > 0) {
                        int progress = (int) (total * 100 / fileLength);
                        if (progress > lastProgress) {
                            JSObject ret = new JSObject();
                            ret.put("progress", progress);
                            notifyListeners("downloadProgress", ret);
                            lastProgress = progress;
                        }
                    }
                    output.write(data, 0, count);
                }

                output.flush();
                output.close();
                input.close();

                JSObject ret = new JSObject();
                ret.put("path", file.getAbsolutePath());
                call.resolve(ret);

            } catch (Exception e) {
                call.reject("Download failed: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void copyFile(PluginCall call) {
        String sourcePath = call.getString("sourcePath");
        String fileName = call.getString("fileName");

        if (sourcePath == null || fileName == null) {
            call.reject("Missing sourcePath or fileName");
            return;
        }

        new Thread(() -> {
            try {
                android.util.Log.i("PiperPlugin", "Copying file from: " + sourcePath + " to: " + fileName);

                // Get target file in files directory
                java.io.File targetFile = new java.io.File(getContext().getFilesDir(), fileName);
                targetFile.getParentFile().mkdirs();

                java.io.InputStream inputStream = null;

                // Handle content:// URIs
                if (sourcePath.startsWith("content://")) {
                    android.net.Uri uri = android.net.Uri.parse(sourcePath);
                    inputStream = getContext().getContentResolver().openInputStream(uri);
                } else {
                    // Handle normal file paths
                    java.io.File sourceFile = new java.io.File(sourcePath);
                    if (!sourceFile.exists() && sourcePath.startsWith("file://")) {
                        sourceFile = new java.io.File(sourcePath.substring(7));
                    }
                    if (!sourceFile.exists()) {
                        call.reject("Source file does not exist: " + sourcePath);
                        return;
                    }
                    inputStream = new java.io.FileInputStream(sourceFile);
                }

                if (inputStream == null) {
                    call.reject("Failed to open input stream");
                    return;
                }

                // Copy file
                try (java.io.InputStream fis = inputStream;
                        java.io.FileOutputStream fos = new java.io.FileOutputStream(targetFile)) {

                    byte[] buffer = new byte[8192];
                    int bytesRead;
                    while ((bytesRead = fis.read(buffer)) != -1) {
                        fos.write(buffer, 0, bytesRead);
                    }
                }

                android.util.Log.i("PiperPlugin", "File copied successfully to: " + targetFile.getAbsolutePath());

                JSObject ret = new JSObject();
                ret.put("path", fileName);
                call.resolve(ret);

            } catch (Exception e) {
                android.util.Log.e("PiperPlugin", "Copy failed: " + e.getMessage(), e);
                call.reject("Copy failed: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void getVoiceInfo(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("voiceId", synthesizer.getCurrentVoiceId());
        call.resolve(ret);
    }

    @Override
    protected void handleOnDestroy() {
        if (synthesizer != null) {
            synthesizer.cleanup();
        }
    }
}
