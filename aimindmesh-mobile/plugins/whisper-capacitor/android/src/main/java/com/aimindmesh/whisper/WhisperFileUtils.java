package com.aimindmesh.whisper;

import android.content.Context;
import android.net.Uri;
import android.util.Log;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

public class WhisperFileUtils {
    private static final String TAG = "WhisperFileUtils";

    /**
     * Unzips an InputStream into a target directory.
     * Includes path traversal protection and directory flattening.
     */
    public static boolean extractZipStream(InputStream inputStream, File targetDir) {
        try {
            if (!targetDir.exists()) {
                targetDir.mkdirs();
            }

            Log.i(TAG, "Extracting Whisper bundle to: " + targetDir.getAbsolutePath());

            try (ZipInputStream zis = new ZipInputStream(new BufferedInputStream(inputStream))) {
                ZipEntry entry;
                byte[] buffer = new byte[128 * 1024];
                String canonicalDest = targetDir.getCanonicalPath();

                while ((entry = zis.getNextEntry()) != null) {
                    File newFile = new File(targetDir, entry.getName());
                    String canonicalFile = newFile.getCanonicalPath();
                    if (!canonicalFile.startsWith(canonicalDest + File.separator) && !canonicalFile.equals(canonicalDest)) {
                        throw new SecurityException("Zip entry is outside target dir: " + entry.getName());
                    }

                    if (entry.isDirectory()) {
                        newFile.mkdirs();
                    } else {
                        File parent = newFile.getParentFile();
                        if (parent != null && !parent.exists()) {
                            parent.mkdirs();
                        }
                        try (FileOutputStream fos = new FileOutputStream(newFile)) {
                            int len;
                            while ((len = zis.read(buffer)) > 0) {
                                fos.write(buffer, 0, len);
                            }
                        }
                    }
                    zis.closeEntry();
                }
            }

            // Flatten single nested top-level directory if present
            flattenNestedDirectory(targetDir);

            Log.i(TAG, "Extraction completed for Whisper model in: " + targetDir.getAbsolutePath());
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Failed to extract Whisper ZIP", e);
            return false;
        }
    }

    /**
     * If the target directory contains only a single subdirectory,
     * move all files from the subdirectory to the target directory.
     */
    public static void flattenNestedDirectory(File targetDir) {
        if (!targetDir.exists() || !targetDir.isDirectory()) return;

        File[] subFiles = targetDir.listFiles();
        if (subFiles != null && subFiles.length == 1 && subFiles[0].isDirectory()) {
            File innerDir = subFiles[0];
            File[] innerFiles = innerDir.listFiles();
            if (innerFiles != null) {
                for (File f : innerFiles) {
                    File dest = new File(targetDir, f.getName());
                    if (dest.exists()) {
                        deleteRecursively(dest);
                    }
                    f.renameTo(dest);
                }
            }
            innerDir.delete();
        }
    }

    /**
     * Resolves the primary binary model path from a file or directory.
     */
    public static File resolveModelBinaryPath(File fileOrDir) {
        if (!fileOrDir.exists()) return null;
        if (fileOrDir.isFile()) return fileOrDir;

        // 1. Look for ggml-*.bin
        File[] ggmlFiles = fileOrDir.listFiles((dir, name) -> name.startsWith("ggml") && name.endsWith(".bin"));
        if (ggmlFiles != null && ggmlFiles.length > 0) {
            return ggmlFiles[0];
        }

        // 2. Look for encoder.bin (for multi-binary bundles like Qualcomm AI Hub Whisper)
        File encoder = new File(fileOrDir, "encoder.bin");
        if (encoder.exists() && encoder.isFile()) {
            return encoder;
        }

        // 3. Look for any *.bin file
        File[] binFiles = fileOrDir.listFiles((dir, name) -> name.endsWith(".bin"));
        if (binFiles != null && binFiles.length > 0) {
            return binFiles[0];
        }

        // 4. Look for nested directory with model
        File[] subDirs = fileOrDir.listFiles(File::isDirectory);
        if (subDirs != null) {
            for (File subDir : subDirs) {
                File found = resolveModelBinaryPath(subDir);
                if (found != null) return found;
            }
        }

        return null;
    }

    /**
     * Recursively deletes a file or directory.
     */
    public static boolean deleteRecursively(File fileOrDir) {
        if (fileOrDir == null || !fileOrDir.exists()) return true;
        if (fileOrDir.isDirectory()) {
            File[] children = fileOrDir.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursively(child);
                }
            }
        }
        return fileOrDir.delete();
    }

    /**
     * Safely opens an InputStream from a content URI or file path.
     */
    public static InputStream openInputStream(Context context, String sourcePath) {
        try {
            if (sourcePath.startsWith("content://")) {
                return context.getContentResolver().openInputStream(Uri.parse(sourcePath));
            } else {
                File f = new File(sourcePath);
                if (f.exists()) {
                    return new FileInputStream(f);
                }
                return context.getContentResolver().openInputStream(Uri.parse(sourcePath));
            }
        } catch (Exception e) {
            Log.e(TAG, "Error opening InputStream for " + sourcePath, e);
            return null;
        }
    }

    /**
     * Reads 16-bit PCM samples from a WAV file (16kHz).
     */
    public static float[] readAudioSamples(File file) throws java.io.IOException {
        try (FileInputStream fis = new FileInputStream(file)) {
            fis.skip(44);
            byte[] buffer = new byte[(int) Math.max(0, file.length() - 44)];
            int read = fis.read(buffer);
            if (read <= 0) return null;

            float[] samples = new float[read / 2];
            for (int i = 0; i < samples.length; i++) {
                short sample = (short) ((buffer[i * 2 + 1] << 8) | (buffer[i * 2] & 0xFF));
                samples[i] = sample / 32768.0f;
            }
            return samples;
        }
    }
}
