package com.aimindmesh.vosk;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import android.Manifest;
import android.util.Base64;
import java.io.File;

@CapacitorPlugin(name = "Vosk", permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
})
public class VoskPlugin extends Plugin {

    private VoskRecognizer recognizer;

    @Override
    public void load() {
        recognizer = new VoskRecognizer(getContext(), this);
    }

    @PluginMethod
    public void loadModel(PluginCall call) {
        String modelPath = call.getString("modelPath");
        if (modelPath == null) {
            call.reject("Model path is required");
            return;
        }

        new Thread(() -> {
            try {
                android.util.Log.i("VoskPlugin", "Loading model: " + modelPath);
                boolean success = recognizer.loadModel(modelPath);
                if (success) {
                    android.util.Log.i("VoskPlugin", "Model loaded successfully: " + modelPath);
                    call.resolve();
                } else {
                    android.util.Log.e("VoskPlugin", "Failed to load model: " + modelPath);
                    call.reject("Failed to load model - model directory not found or invalid");
                }
            } catch (Exception e) {
                android.util.Log.e("VoskPlugin", "Exception loading model: " + e.getMessage(), e);
                call.reject("Error loading model: " + e.getMessage(), e);
            }
        }).start(); // CRITICAL: Start the thread!
    }

    @PluginMethod
    public void unloadModel(PluginCall call) {
        recognizer.unloadModel();
        call.resolve();
    }

    @PluginMethod
    public void loadSpeakerModel(PluginCall call) {
        String modelPath = call.getString("modelPath");
        if (modelPath == null) {
            call.reject("Speaker model path is required");
            return;
        }

        new Thread(() -> {
            try {
                android.util.Log.i("VoskPlugin", "Loading speaker model: " + modelPath);
                boolean success = recognizer.loadSpeakerModel(modelPath);
                if (success) {
                    android.util.Log.i("VoskPlugin", "Speaker model loaded successfully");
                    call.resolve();
                } else {
                    android.util.Log.e("VoskPlugin", "Failed to load speaker model");
                    call.reject("Failed to load speaker model");
                }
            } catch (Exception e) {
                android.util.Log.e("VoskPlugin", "Exception loading speaker model: " + e.getMessage(), e);
                call.reject("Error loading speaker model: " + e.getMessage(), e);
            }
        }).start();
    }

    @PluginMethod
    public void unloadSpeakerModel(PluginCall call) {
        recognizer.unloadSpeakerModel();
        call.resolve();
    }

    @PluginMethod
    public void isSpeakerModelLoaded(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("loaded", recognizer.isSpeakerModelLoaded());
        call.resolve(ret);
    }

    @PluginMethod
    public void startRecognition(PluginCall call) {
        new Thread(() -> {
            try {
                android.util.Log.i("VoskPlugin", "startRecognition thread started");
                recognizer.startRecognition(
                        // On partial result
                        (text) -> {
                            JSObject ret = new JSObject();
                            ret.put("text", text);
                            notifyListeners("partialResult", ret);
                        },
                        // On final result with optional speaker vector
                        (text, speakerVector, startMs, endMs) -> {
                            JSObject ret = new JSObject();
                            ret.put("text", text);
                            ret.put("startMs", startMs);
                            ret.put("endMs", endMs);
                            if (speakerVector != null && speakerVector.length > 0) {
                                try {
                                    org.json.JSONArray spkArray = new org.json.JSONArray();
                                    for (float v : speakerVector) {
                                        spkArray.put(v);
                                    }
                                    ret.put("speakerVector", spkArray);
                                } catch (Exception e) {
                                    android.util.Log.w("VoskPlugin", "Failed to add speaker vector: " + e.getMessage());
                                }
                            }
                            notifyListeners("finalResult", ret);
                        },
                        // On error
                        (error) -> {
                            JSObject ret = new JSObject();
                            ret.put("message", error);
                            notifyListeners("error", ret);
                        });
                call.resolve();
            } catch (Exception e) {
                android.util.Log.e("VoskPlugin", "Error starting recognition", e);
                call.reject("Error starting recognition: " + e.getMessage(), e);
            }
        }).start(); // CRITICAL: Start the thread!
    }

    @PluginMethod
    public void stopRecognition(PluginCall call) {
        recognizer.stopRecognition();
        call.resolve();
    }

    @PluginMethod
    public void isModelLoaded(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("loaded", recognizer.isModelLoaded());
        call.resolve(ret);
    }

    @PluginMethod
    public void downloadModel(PluginCall call) {
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

                // Unzip the model
                String unzipPath = path.substring(0, path.lastIndexOf('.')); // remove .zip extension
                File unzipDir = new File(getContext().getFilesDir(), unzipPath);
                unzip(file, unzipDir);

                // Delete zip file after extraction
                file.delete();

                JSObject ret = new JSObject();
                // Return the relative path to the unzipped directory
                // Note: The zip usually contains a root folder with the model name.
                // We need to find that folder or just use the unzipDir if the zip content is
                // flat (unlikely for Vosk).
                // Vosk models usually have a root folder.
                // Let's check what's inside.
                File[] files = unzipDir.listFiles();
                String finalPath = unzipPath;
                if (files != null && files.length == 1 && files[0].isDirectory()) {
                    finalPath = unzipPath + "/" + files[0].getName();
                }

                ret.put("path", finalPath);
                call.resolve(ret);

            } catch (Exception e) {
                call.reject("Download failed: " + e.getMessage());
            }
        }).start();
    }

    private void unzip(File zipFile, File targetDirectory) throws java.io.IOException {
        java.util.zip.ZipInputStream zis = new java.util.zip.ZipInputStream(
                new java.io.BufferedInputStream(new java.io.FileInputStream(zipFile)));
        try {
            java.util.zip.ZipEntry ze;
            int count;
            byte[] buffer = new byte[8192];
            while ((ze = zis.getNextEntry()) != null) {
                File file = new File(targetDirectory, ze.getName());
                File dir = ze.isDirectory() ? file : file.getParentFile();
                if (!dir.isDirectory() && !dir.mkdirs())
                    throw new java.io.FileNotFoundException("Failed to ensure directory: " + dir.getAbsolutePath());
                if (ze.isDirectory())
                    continue;
                java.io.FileOutputStream fout = new java.io.FileOutputStream(file);
                try {
                    while ((count = zis.read(buffer)) != -1)
                        fout.write(buffer, 0, count);
                } finally {
                    fout.close();
                }
            }
        } finally {
            zis.close();
        }
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
                android.util.Log.i("VoskPlugin", "Copying file from: " + sourcePath + " to: " + fileName);

                // Get target file in files directory
                File targetFile = new File(getContext().getFilesDir(), fileName);
                targetFile.getParentFile().mkdirs();

                java.io.InputStream inputStream = null;

                // Handle content:// URIs
                if (sourcePath.startsWith("content://")) {
                    android.net.Uri uri = android.net.Uri.parse(sourcePath);
                    inputStream = getContext().getContentResolver().openInputStream(uri);
                } else {
                    // Handle normal file paths
                    File sourceFile = new File(sourcePath);
                    if (!sourceFile.exists() && sourcePath.startsWith("file://")) {
                        sourceFile = new File(sourcePath.substring(7));
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

                android.util.Log.i("VoskPlugin", "File copied successfully to: " + targetFile.getAbsolutePath());

                // Now unzip if it's a ZIP file
                if (fileName.endsWith(".zip")) {
                    String unzipPath = fileName.substring(0, fileName.lastIndexOf('.'));
                    File unzipDir = new File(getContext().getFilesDir(), unzipPath);
                    unzip(targetFile, unzipDir);
                    targetFile.delete(); // Delete ZIP after extraction

                    // Check for nested directory
                    File[] files = unzipDir.listFiles();
                    String finalPath = unzipPath;
                    if (files != null && files.length == 1 && files[0].isDirectory()) {
                        finalPath = unzipPath + "/" + files[0].getName();
                    }

                    JSObject ret = new JSObject();
                    ret.put("path", finalPath);
                    call.resolve(ret);
                } else {
                    JSObject ret = new JSObject();
                    ret.put("path", fileName);
                    call.resolve(ret);
                }

            } catch (Exception e) {
                android.util.Log.e("VoskPlugin", "Copy failed: " + e.getMessage(), e);
                call.reject("Copy failed: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void startProcessing(PluginCall call) {
        new Thread(() -> {
            try {
                recognizer.startProcessing();
                call.resolve();
            } catch (Exception e) {
                call.reject("Error starting processing: " + e.getMessage(), e);
            }
        }).start();
    }

    @PluginMethod
    public void submitAudio(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("Missing data");
            return;
        }

        new Thread(() -> {
            try {
                byte[] bytes = Base64.decode(data, Base64.NO_WRAP);
                recognizer.processData(bytes, bytes.length,
                        (text) -> {
                            JSObject ret = new JSObject();
                            ret.put("text", text);
                            notifyListeners("partialResult", ret);
                        },
                        (text, speakerVector, startMs, endMs) -> {
                            JSObject ret = new JSObject();
                            ret.put("text", text);
                            ret.put("startMs", startMs);
                            ret.put("endMs", endMs);
                            if (speakerVector != null && speakerVector.length > 0) {
                                try {
                                    org.json.JSONArray spkArray = new org.json.JSONArray();
                                    for (float v : speakerVector) {
                                        spkArray.put(v);
                                    }
                                    ret.put("speakerVector", spkArray);
                                } catch (Exception e) {
                                }
                            }
                            notifyListeners("finalResult", ret);
                        });
                call.resolve();
            } catch (Exception e) {
                call.reject("Error submitting audio", e);
            }
        }).start();
    }

    @PluginMethod
    public void stopProcessing(PluginCall call) {
        new Thread(() -> {
            recognizer.stopProcessing((text, speakerVector, startMs, endMs) -> {
                JSObject ret = new JSObject();
                ret.put("text", text);
                ret.put("startMs", startMs);
                ret.put("endMs", endMs);
                if (speakerVector != null && speakerVector.length > 0) {
                    try {
                        org.json.JSONArray spkArray = new org.json.JSONArray();
                        for (float v : speakerVector) {
                            spkArray.put(v);
                        }
                        ret.put("speakerVector", spkArray);
                    } catch (Exception e) {
                    }
                }
                notifyListeners("finalResult", ret);
            });
            call.resolve();
        }).start();
    }

    @PluginMethod
    public void getModelInfo(PluginCall call) {
        JSObject ret = new JSObject();
        String[] info = recognizer.getModelInfo();
        ret.put("modelPath", info[0]);
        ret.put("language", info[1]);
        call.resolve(ret);
    }

    public void notifyAudioLevel(float level) {
        JSObject ret = new JSObject();
        ret.put("level", level);
        notifyListeners("audioLevel", ret);
    }

    @Override
    protected void handleOnDestroy() {
        if (recognizer != null) {
            recognizer.cleanup();
        }
    }
}
