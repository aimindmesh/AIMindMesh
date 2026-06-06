package com.aimindmesh.textembedding;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;

import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "TextEmbedding")
public class TextEmbeddingPlugin extends Plugin {

    private TextEmbedder embedder;
    private String currentModelId = "";

    @Override
    public void load() {
        embedder = new TextEmbedder(getContext());
    }

    @PluginMethod
    public void loadModel(PluginCall call) {
        String modelDir = call.getString("modelDir");
        if (modelDir == null || modelDir.isEmpty()) {
            call.reject("Model directory is required");
            return;
        }

        new Thread(() -> {
            try {
                android.util.Log.i("TextEmbedding", "Loading model from directory: " + modelDir);
                int dimension = embedder.loadModel(modelDir);
                if (dimension > 0) {
                    currentModelId = modelDir;
                    android.util.Log.i("TextEmbedding", "Model loaded with dimension: " + dimension);
                    JSObject ret = new JSObject();
                    ret.put("dimension", dimension);
                    call.resolve(ret);
                } else {
                    call.reject("Failed to load model: invalid dimension");
                }
            } catch (Exception e) {
                android.util.Log.e("TextEmbedding", "Exception loading model: " + e.getMessage(), e);
                call.reject("Error loading model: " + e.getMessage(), e);
            }
        }).start();
    }

    @PluginMethod
    public void unloadModel(PluginCall call) {
        embedder.unloadModel();
        currentModelId = "";
        call.resolve();
    }

    @PluginMethod
    public void isModelLoaded(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("loaded", embedder.isModelLoaded());
        ret.put("dimension", embedder.getEmbeddingDimension());
        ret.put("modelId", currentModelId);
        call.resolve(ret);
    }

    @PluginMethod
    public void generateEmbedding(PluginCall call) {
        String text = call.getString("text");

        if (text == null || text.isEmpty()) {
            call.reject("Text is required");
            return;
        }

        if (!embedder.isModelLoaded()) {
            call.reject("No model is loaded");
            return;
        }
        
        android.util.Log.i("TextEmbedding", "generateEmbedding called from JS for text length: " + text.length());

        new Thread(() -> {
            try {
                float[] embedding = embedder.generateEmbedding(text);

                if (embedding != null) {
                    JSObject ret = new JSObject();
                    JSONArray embeddingArray = new JSONArray();
                    for (float v : embedding) {
                        embeddingArray.put(v);
                    }
                    ret.put("embedding", embeddingArray);
                    ret.put("dimension", embedding.length);
                    call.resolve(ret);
                } else {
                    call.reject("Failed to generate embedding");
                }
            } catch (Exception e) {
                android.util.Log.e("TextEmbedding", "Error generating embedding: " + e.getMessage(), e);
                call.reject("Error generating embedding: " + e.getMessage(), e);
            }
        }).start();
    }

    @PluginMethod
    public void generateEmbeddingBatch(PluginCall call) {
        JSArray textsArray = call.getArray("texts");

        if (textsArray == null || textsArray.length() == 0) {
            call.reject("Texts array is required");
            return;
        }

        if (!embedder.isModelLoaded()) {
            call.reject("No model is loaded");
            return;
        }

        List<String> texts = new ArrayList<>();
        try {
            for (int i = 0; i < textsArray.length(); i++) {
                texts.add(textsArray.getString(i));
            }
        } catch (JSONException e) {
            call.reject("Invalid texts array format");
            return;
        }

        new Thread(() -> {
            try {
                List<float[]> embeddings = new ArrayList<>();
                for (String text : texts) {
                    float[] embedding = embedder.generateEmbedding(text);
                    if (embedding != null) {
                        embeddings.add(embedding);
                    }
                }

                JSObject ret = new JSObject();
                JSONArray embeddingsArray = new JSONArray();
                for (float[] emb : embeddings) {
                    JSObject embResult = new JSObject();
                    JSONArray embValues = new JSONArray();
                    for (float v : emb) {
                        embValues.put(v);
                    }
                    embResult.put("embedding", embValues);
                    embResult.put("dimension", emb.length);
                    embeddingsArray.put(embResult);
                }
                ret.put("embeddings", embeddingsArray);
                call.resolve(ret);
            } catch (Exception e) {
                android.util.Log.e("TextEmbedding", "Error in batch embedding: " + e.getMessage(), e);
                call.reject("Error in batch embedding: " + e.getMessage(), e);
            }
        }).start();
    }

    @PluginMethod
    public void importModelZip(PluginCall call) {
        String sourcePath = call.getString("sourcePath");
        String modelId = call.getString("modelId");

        if (sourcePath == null || sourcePath.isEmpty()) {
            call.reject("Source path is required");
            return;
        }

        if (modelId == null || modelId.isEmpty()) {
            call.reject("Model ID is required");
            return;
        }

        new Thread(() -> {
            try {
                android.util.Log.i("TextEmbedding", "Importing model ZIP from: " + sourcePath);

                // Target directory
                java.io.File modelsDir = new java.io.File(getContext().getFilesDir(), "embedding_models");
                if (!modelsDir.exists()) {
                    modelsDir.mkdirs();
                }

                java.io.File modelDir = new java.io.File(modelsDir, modelId);
                if (!modelDir.exists()) {
                    modelDir.mkdirs();
                }

                // First copy the ZIP file
                java.io.File tempZip = new java.io.File(modelDir, "temp.zip");
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
                        java.io.FileOutputStream fos = new java.io.FileOutputStream(tempZip)) {
                    byte[] buffer = new byte[8192];
                    int bytesRead;
                    while ((bytesRead = fis.read(buffer)) != -1) {
                        fos.write(buffer, 0, bytesRead);
                    }
                }

                android.util.Log.i("TextEmbedding", "ZIP copied, size: " + tempZip.length() + " bytes");

                // Unzip
                unzip(tempZip, modelDir);

                // Delete temp ZIP
                tempZip.delete();

                android.util.Log.i("TextEmbedding", "Model extracted to: " + modelDir.getAbsolutePath());

                // Verify required files
                java.io.File modelFile = new java.io.File(modelDir, "model.onnx");
                java.io.File tokenizerFile = new java.io.File(modelDir, "tokenizer.json");

                // Check if files are in a subdirectory
                if (!modelFile.exists() || !tokenizerFile.exists()) {
                    java.io.File[] files = modelDir.listFiles();
                    if (files != null && files.length == 1 && files[0].isDirectory()) {
                        // Files might be in a subdirectory
                        java.io.File subDir = files[0];
                        modelFile = new java.io.File(subDir, "model.onnx");
                        tokenizerFile = new java.io.File(subDir, "tokenizer.json");

                        if (modelFile.exists() && tokenizerFile.exists()) {
                            // Move files up
                            for (java.io.File f : subDir.listFiles()) {
                                java.io.File dest = new java.io.File(modelDir, f.getName());
                                f.renameTo(dest);
                            }
                            subDir.delete();
                        }
                    }
                }

                modelFile = new java.io.File(modelDir, "model.onnx");
                tokenizerFile = new java.io.File(modelDir, "tokenizer.json");

                if (!modelFile.exists()) {
                    call.reject("ZIP does not contain model.onnx");
                    return;
                }
                if (!tokenizerFile.exists()) {
                    call.reject("ZIP does not contain tokenizer.json");
                    return;
                }

                JSObject ret = new JSObject();
                ret.put("path", "embedding_models/" + modelId);
                ret.put("modelId", modelId);
                call.resolve(ret);

            } catch (Exception e) {
                android.util.Log.e("TextEmbedding", "Import failed: " + e.getMessage(), e);
                call.reject("Import failed: " + e.getMessage());
            }
        }).start();
    }

    private void unzip(java.io.File zipFile, java.io.File targetDirectory) throws java.io.IOException {
        java.util.zip.ZipInputStream zis = new java.util.zip.ZipInputStream(
                new java.io.BufferedInputStream(new java.io.FileInputStream(zipFile)));
        try {
            java.util.zip.ZipEntry ze;
            byte[] buffer = new byte[8192];
            while ((ze = zis.getNextEntry()) != null) {
                java.io.File file = new java.io.File(targetDirectory, ze.getName());
                java.io.File dir = ze.isDirectory() ? file : file.getParentFile();
                if (!dir.isDirectory() && !dir.mkdirs()) {
                    throw new java.io.FileNotFoundException("Failed to ensure directory: " + dir.getAbsolutePath());
                }
                if (ze.isDirectory())
                    continue;
                java.io.FileOutputStream fout = new java.io.FileOutputStream(file);
                try {
                    int count;
                    while ((count = zis.read(buffer)) != -1) {
                        fout.write(buffer, 0, count);
                    }
                } finally {
                    fout.close();
                }
            }
        } finally {
            zis.close();
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (embedder != null) {
            embedder.cleanup();
        }
    }
}
