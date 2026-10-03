package com.aimindmesh.llama;

import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Background GGUF downloads (moved out of LlamaCpp).
 *
 * The file is written to "<name>.part" and renamed only once complete, so a download that is
 * killed, cancelled or truncated never looks like an installed model.
 */
final class GgufDownloader {
    private static final String TAG = "LlamaCpp";
    private static final int CONNECT_TIMEOUT_MS = 30_000;
    // A stalled connection fails instead of hanging forever (and Cancel gets a chance to run)
    private static final int READ_TIMEOUT_MS = 60_000;
    private static final long FREE_SPACE_MARGIN = 64L * 1024 * 1024;

    static final class Status {
        volatile long totalBytes = 0;
        volatile long downloadedBytes = 0;
        volatile boolean completed = false;
        volatile boolean failed = false;
        volatile boolean cancelled = false;
        volatile String error = null;
        volatile String localPath = null;
    }

    private final File filesDir;
    private final Map<String, Status> active = new ConcurrentHashMap<>();

    GgufDownloader(File filesDir) {
        this.filesDir = filesDir;
    }

    /** Starts (or joins) the download of url and returns the final local path immediately. */
    String start(String url, String filename, String hfToken) {
        File target = new File(filesDir, filename);
        Status existing = active.get(url);
        if (existing != null && !existing.completed && !existing.failed && !existing.cancelled) {
            return existing.localPath; // one writer per .part file
        }
        Status status = new Status();
        status.localPath = target.getAbsolutePath();
        active.put(url, status);
        new Thread(() -> download(url, target, hfToken, status), "GGUF-Download").start();
        return status.localPath;
    }

    /** Progress map in the shape the JS side polls, or null for an unknown url. */
    Map<String, Object> progress(String url) {
        Status status = active.get(url);
        if (status == null) return null;
        Map<String, Object> progress = new HashMap<>();
        progress.put("bytesDownloaded", status.downloadedBytes);
        progress.put("totalBytes", status.totalBytes);
        progress.put("completed", status.completed);
        progress.put("failed", status.failed);
        progress.put("cancelled", status.cancelled);
        progress.put("error", status.error);
        return progress;
    }

    /** @return false if the url is not being downloaded by this class */
    boolean cancel(String url) {
        Status status = active.get(url);
        if (status == null) return false;
        status.cancelled = true;
        return true;
    }

    private void download(String url, File target, String hfToken, Status status) {
        File part = new File(target.getPath() + ".part");
        HttpURLConnection connection = null;
        try {
            File parent = target.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs()) {
                throw new IOException("Cannot create " + parent);
            }
            if (part.exists() && !part.delete()) {
                throw new IOException("Cannot replace stale " + part.getName());
            }

            connection = open(url, hfToken);
            long fileSize = connection.getContentLengthLong();
            status.totalBytes = fileSize;
            Log.i(TAG, "File size: " + fileSize + " bytes");

            long usable = filesDir.getUsableSpace();
            if (fileSize > 0 && usable < fileSize + FREE_SPACE_MARGIN) {
                throw new IOException("Not enough free space: the model needs " + (fileSize / (1024 * 1024))
                        + " MB, only " + (usable / (1024 * 1024)) + " MB available");
            }

            long downloadedBytes = 0;
            try (InputStream inputStream = connection.getInputStream();
                    FileOutputStream outputStream = new FileOutputStream(part)) {
                byte[] buffer = new byte[256 * 1024];
                int bytesRead;
                long nextLog = 0;
                while ((bytesRead = inputStream.read(buffer)) != -1) {
                    if (status.cancelled) break;
                    outputStream.write(buffer, 0, bytesRead);
                    downloadedBytes += bytesRead;
                    status.downloadedBytes = downloadedBytes;
                    if (downloadedBytes >= nextLog) {
                        Log.i(TAG, "Download progress: " + downloadedBytes + "/" + fileSize + " bytes");
                        nextLog = downloadedBytes + 64L * 1024 * 1024;
                    }
                }
                outputStream.getFD().sync();
            }

            if (status.cancelled) {
                // Status entry is kept with cancelled=true so the JS poll sees it
                Log.i(TAG, "Download cancelled: " + url);
                part.delete();
                return;
            }
            if (fileSize > 0 && downloadedBytes != fileSize) {
                throw new IOException("Incomplete download: " + downloadedBytes + " of " + fileSize + " bytes");
            }
            if (downloadedBytes < 1024) {
                throw new IOException("Download too small (" + downloadedBytes + " bytes). Likely invalid file or error page.");
            }

            // rename(2): atomic, replaces an older copy of the model in one step
            if (!part.renameTo(target)) {
                throw new IOException("Cannot move the download into place: " + target);
            }
            Log.i(TAG, "Download completed successfully: " + target);
            status.completed = true;
        } catch (Exception e) {
            Log.e(TAG, "Download failed: " + e.getMessage());
            status.error = e.getMessage();
            status.failed = !status.cancelled;
            part.delete();
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    /** Follows redirects; the HF token is only sent to the original host, never to CDN/S3 hosts. */
    private static HttpURLConnection open(String url, String hfToken) throws IOException {
        URL downloadUrl = new URL(url);
        String tokenHost = downloadUrl.getHost();
        for (int redirects = 0; redirects < 10; redirects++) {
            HttpURLConnection connection = (HttpURLConnection) downloadUrl.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            if (hfToken != null && !hfToken.isEmpty() && downloadUrl.getHost().equalsIgnoreCase(tokenHost)) {
                connection.setRequestProperty("Authorization", "Bearer " + hfToken);
            }

            int responseCode = connection.getResponseCode();
            if (responseCode == HttpURLConnection.HTTP_MOVED_PERM || responseCode == HttpURLConnection.HTTP_MOVED_TEMP
                    || responseCode == HttpURLConnection.HTTP_SEE_OTHER || responseCode == 307 || responseCode == 308) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null) throw new IOException("Redirect without Location from " + downloadUrl);
                downloadUrl = new URL(downloadUrl, location); // Location may be relative
                Log.i(TAG, "Redirecting to: " + downloadUrl.getHost());
                continue;
            }
            if (responseCode != HttpURLConnection.HTTP_OK) {
                connection.disconnect();
                throw new IOException("HTTP error code: " + responseCode + " for URL: " + downloadUrl);
            }
            return connection;
        }
        throw new IOException("Too many redirects");
    }
}
