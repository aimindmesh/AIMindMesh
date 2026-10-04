package com.aimindmesh.mobile.utils;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Unpacks the speech models bundled in the APK (assets/bundled_models, see
 * scripts/fetch-bundled-models.sh) into files/, at the paths the model downloaders use.
 *
 * Nothing the user already has is overwritten or deleted: a model already in place (downloaded,
 * imported or chosen by the user, e.g. another speaker model at models/ecapa_tdnn.onnx) is kept.
 * Every model is written under a temporary name and renamed into place only once complete, so an
 * interrupted first launch never leaves a truncated model that later looks valid. A model missing
 * from the APK (a build without models) is skipped. The JS layer waits for READY before loading.
 */
public class ModelAssetManager {

    private static final String TAG = "ModelAssetManager";
    /** Bump when the bundled set changes, so updates unpack the new models. */
    private static final String MARKER_FILE_NAME = ".models_bundled_amm_v1";
    static final String COMPLETE_MARKER = ".complete";
    private static final String ASSETS_DIR = "bundled_models";
    private static final int BUFFER_SIZE = 65536;

    static final String[] VOSK_MODELS = {
            "vosk-model-small-it-0.22",
            "vosk-model-small-en-us-0.15",
            "vosk-model-en-us-0.22-lgraph",
            "vosk-model-spk-0.4",
    };
    /** { asset name, destination relative to files/ } */
    static final String[][] FILE_MODELS = {
            { "silero_vad.onnx", "vad-models/silero-vad-v4.onnx" },
            { "voxceleb_ECAPA512.onnx", "models/ecapa_tdnn.onnx" },
            { "ggml-base-q8_0.bin", "whisper-models/ggml-base-q8_0.bin" },
    };

    public enum Status { NOT_STARTED, RUNNING, READY, FAILED }

    private static volatile Status status = Status.NOT_STARTED;
    private static volatile String lastError = null;

    public static Status getStatus() {
        return status;
    }

    public static String getLastError() {
        return lastError;
    }

    /** Unpacks the bundled models on a background thread (no-op when done or running). */
    public static void unpackBundledModelsAsync(final Context context) {
        if (status == Status.RUNNING || status == Status.READY) {
            return;
        }
        status = Status.RUNNING;
        new Thread(() -> unpackBundledModels(context.getApplicationContext()), "ModelAssetManager-Unpacker").start();
    }

    public static synchronized void unpackBundledModels(Context context) {
        File filesDir = context.getFilesDir();
        File marker = new File(filesDir, MARKER_FILE_NAME);
        status = Status.RUNNING;
        AssetManager assets = context.getAssets();
        Set<String> bundled = bundledAssets(assets);

        if (marker.exists() && areModelsPresent(filesDir, bundled)) {
            Log.i(TAG, "Bundled models are already in place");
            status = Status.READY;
            return;
        }

        long startTime = System.currentTimeMillis();
        try {
            for (String model : VOSK_MODELS) {
                if (!bundled.contains(model + ".zip")) {
                    Log.w(TAG, "Not bundled in this build: " + model);
                    continue;
                }
                try (InputStream in = assets.open(ASSETS_DIR + "/" + model + ".zip")) {
                    unpackVoskModel(in, new File(filesDir, "vosk-models"), model);
                }
            }
            for (String[] model : FILE_MODELS) {
                if (!bundled.contains(model[0])) {
                    Log.w(TAG, "Not bundled in this build: " + model[0]);
                    continue;
                }
                try (InputStream in = assets.open(ASSETS_DIR + "/" + model[0])) {
                    copyIfMissing(in, new File(filesDir, model[1]));
                }
            }
            if (!marker.exists() && !marker.createNewFile()) {
                throw new IOException("Cannot create " + marker);
            }
            Log.i(TAG, "Bundled models ready in " + (System.currentTimeMillis() - startTime) + " ms");
            status = Status.READY;
        } catch (IOException | SecurityException e) {
            Log.e(TAG, "Failed to unpack bundled models", e);
            lastError = e.getMessage();
            status = Status.FAILED;
        }
    }

    private static Set<String> bundledAssets(AssetManager assets) {
        try {
            String[] names = assets.list(ASSETS_DIR);
            return new HashSet<>(Arrays.asList(names == null ? new String[0] : names));
        } catch (IOException e) {
            return new HashSet<>();
        }
    }

    private static boolean areModelsPresent(File filesDir, Set<String> bundled) {
        for (String model : VOSK_MODELS) {
            if (bundled.contains(model + ".zip")
                    && !new File(filesDir, "vosk-models/" + model + "/" + COMPLETE_MARKER).exists()) {
                return false;
            }
        }
        for (String[] model : FILE_MODELS) {
            File f = new File(filesDir, model[1]);
            if (bundled.contains(model[0]) && (!f.exists() || f.length() == 0)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Unpacks a Vosk model zip into voskDir/modelName, through a temporary directory renamed into
     * place once every entry is written. The zip's own root folder (modelName/) is stripped.
     * A model directory already there (downloaded or imported) is kept and marked complete.
     */
    static void unpackVoskModel(InputStream zip, File voskDir, String modelName) throws IOException {
        File targetDir = new File(voskDir, modelName);
        File completeMarker = new File(targetDir, COMPLETE_MARKER);
        if (completeMarker.exists()) {
            return;
        }
        String[] existing = targetDir.list();
        if (existing != null && existing.length > 0) {
            if (!completeMarker.createNewFile()) {
                throw new IOException("Cannot create " + completeMarker);
            }
            Log.i(TAG, "Keeping the installed " + modelName);
            return;
        }

        File tmpDir = new File(voskDir, modelName + ".tmp");
        deleteRecursively(tmpDir);
        if (!tmpDir.mkdirs()) {
            throw new IOException("Cannot create " + tmpDir);
        }
        Log.i(TAG, "Unpacking " + modelName);

        try (ZipInputStream zis = new ZipInputStream(zip)) {
            byte[] buffer = new byte[BUFFER_SIZE];
            String tmpDirPath = tmpDir.getCanonicalPath();
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                String entryName = entry.getName();
                if (entryName.startsWith(modelName + "/")) {
                    entryName = entryName.substring(modelName.length() + 1);
                }
                if (entryName.isEmpty()) {
                    zis.closeEntry();
                    continue;
                }
                File destFile = new File(tmpDir, entryName);
                // Zip slip: an entry may not escape the target directory
                String destPath = destFile.getCanonicalPath();
                if (!destPath.startsWith(tmpDirPath + File.separator)) {
                    throw new SecurityException("Zip entry is outside target dir: " + entry.getName());
                }
                if (entry.isDirectory()) {
                    destFile.mkdirs();
                } else {
                    File parent = destFile.getParentFile();
                    if (parent != null && !parent.exists()) {
                        parent.mkdirs();
                    }
                    try (OutputStream os = new FileOutputStream(destFile)) {
                        int read;
                        while ((read = zis.read(buffer)) != -1) {
                            os.write(buffer, 0, read);
                        }
                    }
                }
                zis.closeEntry();
            }
        } catch (IOException | SecurityException e) {
            deleteRecursively(tmpDir);
            throw e;
        }

        if (!new File(tmpDir, COMPLETE_MARKER).createNewFile()) {
            throw new IOException("Cannot mark " + tmpDir + " complete");
        }
        deleteRecursively(targetDir);
        if (!tmpDir.renameTo(targetDir)) {
            throw new IOException("Cannot move " + tmpDir + " to " + targetDir);
        }
    }

    /** Copies a model file through a temporary file, unless the destination already exists. */
    static void copyIfMissing(InputStream in, File destFile) throws IOException {
        if (destFile.exists() && destFile.length() > 0) {
            return;
        }
        File parent = destFile.getParentFile();
        if (parent != null && !parent.exists()) {
            parent.mkdirs();
        }
        Log.i(TAG, "Copying " + destFile.getName());
        File tmp = new File(destFile.getPath() + ".tmp");
        try (OutputStream os = new FileOutputStream(tmp)) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int read;
            while ((read = in.read(buffer)) != -1) {
                os.write(buffer, 0, read);
            }
        } catch (IOException e) {
            tmp.delete();
            throw e;
        }
        if (!tmp.renameTo(destFile)) {
            tmp.delete();
            throw new IOException("Cannot move " + tmp + " to " + destFile);
        }
    }

    static void deleteRecursively(File f) {
        File[] children = f.listFiles();
        if (children != null) {
            for (File child : children) {
                deleteRecursively(child);
            }
        }
        f.delete();
    }
}
