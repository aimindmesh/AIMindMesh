package com.aimindmesh.mobile.meeting;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * Backup archives of all meetings: one zip with the data written by the web layer
 * (meetings.json) and the meeting audio files, built and extracted here so that gigabytes of
 * audio never go through the WebView.
 *
 * Layout: meetings.json, audio/{meetingId}.audio
 */
@CapacitorPlugin(name = "Backup")
public class BackupPlugin extends Plugin {
    private static final String TAG = "BackupPlugin";
    private static final String DATA_ENTRY = "meetings.json";
    private static final String AUDIO_PREFIX = "audio/";
    private static final long MAX_DATA_BYTES = 256L * 1024 * 1024;

    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @Override
    protected void handleOnDestroy() {
        io.shutdown();
    }

    private File audioDir() {
        return new File(getContext().getFilesDir(), "meeting-audio");
    }

    /**
     * Where an archive is extracted: next to the meeting audio rather than in the cache, so
     * restored recordings are moved (not copied) and aren't accounted as cache.
     */
    private File restoreDir() {
        return new File(getContext().getFilesDir(), "restore-staging");
    }

    /**
     * Zips {dataPath} and the audio of {meetingIds} into cache/backups/ and returns
     * { path, bytes }. Audio is stored, not compressed: it is AAC already.
     */
    @PluginMethod
    public void createArchive(PluginCall call) {
        String dataPath = call.getString("dataPath");
        JSArray ids = call.getArray("meetingIds", new JSArray());
        if (dataPath == null) {
            call.reject("dataPath is required");
            return;
        }
        io.execute(() -> {
            File dir = new File(getContext().getCacheDir(), "backups");
            deleteRecursively(dir);
            if (!dir.mkdirs()) {
                call.reject("Cannot create " + dir);
                return;
            }
            String stamp = new SimpleDateFormat("yyyy-MM-dd_HHmm", Locale.ROOT).format(new Date());
            File out = new File(dir, "AIMindMesh-meetings-backup-" + stamp + ".zip");
            int audioCount = 0;
            try (ZipOutputStream zip = new ZipOutputStream(new BufferedOutputStream(new FileOutputStream(out), 1 << 16))) {
                zip.putNextEntry(new ZipEntry(DATA_ENTRY));
                copy(new FileInputStream(new File(stripScheme(dataPath))), zip);
                zip.closeEntry();
                zip.setLevel(0);
                for (int i = 0; i < ids.length(); i++) {
                    String id = ids.getString(i);
                    File audio = new File(audioDir(), id + ".audio");
                    if (!isPlainName(id) || !audio.isFile()) continue;
                    zip.putNextEntry(new ZipEntry(AUDIO_PREFIX + id + ".audio"));
                    copy(new FileInputStream(audio), zip);
                    zip.closeEntry();
                    audioCount++;
                }
            } catch (IOException | JSONException e) {
                Log.e(TAG, "Backup failed", e);
                out.delete();
                call.reject("Backup failed: " + e.getMessage(), e);
                return;
            }
            Log.i(TAG, "Backup written: " + out.length() + " bytes, " + audioCount + " recordings");
            JSObject ret = new JSObject();
            ret.put("path", out.getAbsolutePath());
            ret.put("bytes", out.length());
            ret.put("audioFiles", audioCount);
            call.resolve(ret);
        });
    }

    /** Lets the user pick a backup archive, then extracts it (see extract). */
    @PluginMethod
    public void pickArchive(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType("*/*")
                .putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "application/zip", "application/x-zip-compressed", "application/octet-stream" });
        startActivityForResult(call, intent, "archivePicked");
    }

    @ActivityCallback
    private void archivePicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Uri uri = result.getData() != null ? result.getData().getData() : null;
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            JSObject ret = new JSObject();
            ret.put("cancelled", true);
            call.resolve(ret);
            return;
        }
        io.execute(() -> extract(call, uri));
    }

    /**
     * Extracts an archive into the restore folder and returns { dir, dataPath, audioFiles }.
     * Only the expected entries are written, by name, so the archive can't place files elsewhere.
     */
    private void extract(PluginCall call, Uri uri) {
        File dir = restoreDir();
        deleteRecursively(dir);
        File audioOut = new File(dir, "audio");
        if (!audioOut.mkdirs()) {
            call.reject("Cannot create " + dir);
            return;
        }
        boolean hasData = false;
        int audioCount = 0;
        try (InputStream in = getContext().getContentResolver().openInputStream(uri);
             ZipInputStream zip = new ZipInputStream(new BufferedInputStream(in, 1 << 16))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                String name = entry.getName();
                if (entry.isDirectory()) continue;
                if (DATA_ENTRY.equals(name)) {
                    copyLimited(zip, new File(dir, DATA_ENTRY), MAX_DATA_BYTES);
                    hasData = true;
                } else if (name.startsWith(AUDIO_PREFIX) && name.endsWith(".audio")) {
                    String id = name.substring(AUDIO_PREFIX.length(), name.length() - ".audio".length());
                    if (!isPlainName(id)) continue;
                    copyLimited(zip, new File(audioOut, id + ".audio"), Long.MAX_VALUE);
                    audioCount++;
                }
            }
        } catch (IOException | SecurityException e) {
            Log.e(TAG, "Cannot read the backup", e);
            deleteRecursively(dir);
            call.reject("Cannot read the backup: " + e.getMessage(), e);
            return;
        }
        if (!hasData) {
            deleteRecursively(dir);
            call.reject("This file is not a meetings backup");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("dir", dir.getAbsolutePath());
        ret.put("dataPath", new File(dir, DATA_ENTRY).getAbsolutePath());
        ret.put("audioFiles", audioCount);
        call.resolve(ret);
    }

    /** Moves an extracted recording into place; never overwrites an existing one. Resolves { restored }. */
    @PluginMethod
    public void restoreAudio(PluginCall call) {
        String id = call.getString("meetingId");
        if (id == null || !isPlainName(id)) {
            call.reject("Invalid meeting id");
            return;
        }
        io.execute(() -> {
            File from = new File(new File(restoreDir(), "audio"), id + ".audio");
            File to = new File(audioDir(), id + ".audio");
            boolean restored = false;
            if (from.isFile() && !to.exists() && (audioDir().isDirectory() || audioDir().mkdirs())) {
                restored = from.renameTo(to);
            }
            JSObject ret = new JSObject();
            ret.put("restored", restored);
            call.resolve(ret);
        });
    }

    /** Deletes the temporary backup and restore folders. */
    @PluginMethod
    public void cleanup(PluginCall call) {
        io.execute(() -> {
            deleteRecursively(restoreDir());
            deleteRecursively(new File(getContext().getCacheDir(), "backups"));
            call.resolve();
        });
    }

    /** Meeting ids are generated by the app: anything else could name a path. */
    private static boolean isPlainName(String name) {
        return name.matches("[A-Za-z0-9_-]{1,100}");
    }

    private static String stripScheme(String path) {
        return path.startsWith("file://") ? path.substring("file://".length()) : path;
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        try (InputStream source = in) {
            byte[] buffer = new byte[1 << 16];
            int n;
            while ((n = source.read(buffer)) > 0) {
                out.write(buffer, 0, n);
            }
        }
    }

    private static void copyLimited(ZipInputStream zip, File target, long maxBytes) throws IOException {
        try (OutputStream out = new BufferedOutputStream(new FileOutputStream(target), 1 << 16)) {
            byte[] buffer = new byte[1 << 16];
            long total = 0;
            int n;
            while ((n = zip.read(buffer)) > 0) {
                total += n;
                if (total > maxBytes) throw new IOException("Backup entry too large: " + target.getName());
                out.write(buffer, 0, n);
            }
        }
    }

    private static void deleteRecursively(File f) {
        File[] children = f.listFiles();
        if (children != null) {
            for (File c : children) deleteRecursively(c);
        }
        f.delete();
    }
}
