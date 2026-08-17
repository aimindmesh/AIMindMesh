package com.aimindmesh.mobile.tts.kokoro

import android.content.Context
import android.net.Uri
import android.util.Log
import kotlinx.coroutines.*
import org.apache.commons.compress.archivers.tar.TarArchiveEntry
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.archivers.zip.ZipArchiveEntry
import org.apache.commons.compress.archivers.zip.ZipArchiveInputStream
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLDecoder

object ModelDownloader {

    private const val TAG = "KokoroModelDownloader"
    private const val BASE_URL =
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/"

    fun isModelReady(context: Context): Boolean {
        val destDir = File(context.filesDir, "kokoro-multi-lang-v1_0")
        val modelFile = File(destDir, "model.onnx")
        val voicesFile = File(destDir, "voices.bin")
        val tokensFile = File(destDir, "tokens.txt")
        return modelFile.exists() && modelFile.length() > 50_000_000L &&
                voicesFile.exists() && tokensFile.exists()
    }

    fun getModelDir(context: Context): String {
        return File(context.filesDir, "kokoro-multi-lang-v1_0").absolutePath
    }

    fun extractLocalModel(
        context: Context,
        sourceFilePath: String,
        onProgress: (Int, String) -> Unit,
        onComplete: (File) -> Unit,
        onError: (String) -> Unit
    ) {
        val destDir = File(context.filesDir, "kokoro-multi-lang-v1_0")

        CoroutineScope(Dispatchers.IO).launch {
            try {
                destDir.mkdirs()
                Log.i(TAG, "Starting extraction of local model from: $sourceFilePath")

                val (inputStream, totalBytes) = openSourceStream(context, sourceFilePath)

                extractArchiveStream(
                    inputStream = inputStream,
                    totalBytes = totalBytes,
                    destDir = destDir,
                    sourceIdentifier = sourceFilePath,
                    onProgress = { percent ->
                        CoroutineScope(Dispatchers.Main).launch {
                            onProgress(percent, "Extracting files... $percent%")
                        }
                    }
                )

                if (!isModelReady(context)) {
                    throw RuntimeException("Missing essential files (model.onnx, voices.bin, tokens.txt)")
                }

                Log.i(TAG, "Extraction completed successfully into: ${destDir.absolutePath}")
                withContext(Dispatchers.Main) {
                    onProgress(100, "Extraction completed")
                    onComplete(destDir)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to extract local Kokoro model", e)
                withContext(Dispatchers.Main) {
                    onError(e.message ?: "Error during local extraction")
                }
            }
        }
    }

    fun ensureModel(
        context: Context,
        onProgress: (Int, String) -> Unit,
        onComplete: (File) -> Unit,
        onError: (String) -> Unit
    ) {
        val destDir = File(context.filesDir, "kokoro-multi-lang-v1_0")

        if (isModelReady(context)) {
            onComplete(destDir)
            return
        }

        CoroutineScope(Dispatchers.IO).launch {
            try {
                destDir.mkdirs()
                val tarFile = File(context.cacheDir, "kokoro-multi-lang-v1_0.tar.bz2")

                // Download bundle
                val url = "${BASE_URL}kokoro-multi-lang-v1_0.tar.bz2"
                Log.i(TAG, "Downloading Kokoro bundle from: $url")
                downloadFile(url, tarFile) { progress ->
                    withContext(Dispatchers.Main) {
                        onProgress(progress, "Downloading... $progress%")
                    }
                }

                // In-JVM extraction via commons-compress
                withContext(Dispatchers.Main) {
                    onProgress(0, "Extracting files... 0%")
                }
                
                val totalBytes = tarFile.length()
                FileInputStream(tarFile).use { fis ->
                    extractArchiveStream(
                        inputStream = fis,
                        totalBytes = totalBytes,
                        destDir = destDir,
                        sourceIdentifier = tarFile.name,
                        onProgress = { percent ->
                            CoroutineScope(Dispatchers.Main).launch {
                                onProgress(percent, "Extracting files... $percent%")
                            }
                        }
                    )
                }

                tarFile.delete()

                if (!isModelReady(context)) {
                    throw RuntimeException("Missing essential files after download")
                }

                Log.i(TAG, "Download and extraction completed successfully into: ${destDir.absolutePath}")
                withContext(Dispatchers.Main) {
                    onProgress(100, "Completed")
                    onComplete(destDir)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to download and extract Kokoro model", e)
                withContext(Dispatchers.Main) {
                    onError(e.message ?: "Unknown error during download/extraction")
                }
            }
        }
    }

    private fun openSourceStream(context: Context, sourceFilePath: String): Pair<InputStream, Long> {
        if (sourceFilePath.startsWith("content://")) {
            val uri = Uri.parse(sourceFilePath)
            val stream = context.contentResolver.openInputStream(uri)
                ?: throw RuntimeException("Unable to open URI: $sourceFilePath")

            var totalBytes = -1L
            try {
                context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { afd ->
                    totalBytes = afd.length
                }
            } catch (e: Exception) {
                Log.w(TAG, "Unable to determine content size: ${e.message}")
            }
            return Pair(stream, totalBytes)
        }

        var cleanPath = sourceFilePath
        if (cleanPath.startsWith("file://")) {
            cleanPath = cleanPath.removePrefix("file://")
        }
        try {
            cleanPath = URLDecoder.decode(cleanPath, "UTF-8")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to URL decode path: $cleanPath")
        }

        val file = File(cleanPath)
        if (!file.exists()) {
            if (sourceFilePath.contains("://")) {
                val uri = Uri.parse(sourceFilePath)
                val stream = context.contentResolver.openInputStream(uri)
                    ?: throw RuntimeException("File not found: $sourceFilePath")
                return Pair(stream, -1L)
            }
            throw RuntimeException("File not found: $cleanPath")
        }

        return Pair(FileInputStream(file), file.length())
    }

    private fun extractArchiveStream(
        inputStream: InputStream,
        totalBytes: Long,
        destDir: File,
        sourceIdentifier: String,
        onProgress: (Int) -> Unit
    ) {
        val lowerId = sourceIdentifier.lowercase()
        val isZip = lowerId.endsWith(".zip")
        val isGzip = lowerId.endsWith(".tar.gz") || lowerId.endsWith(".tgz") || lowerId.endsWith(".gz")
        val isBzip2 = lowerId.endsWith(".tar.bz2") || lowerId.endsWith(".tbz2") || lowerId.endsWith(".bz2") || (!isZip && !isGzip)

        val progressStream = ProgressInputStream(inputStream, totalBytes, onProgress)
        val bufferedStream = BufferedInputStream(progressStream, 65536)

        val canonicalDestPath = destDir.canonicalPath

        if (isZip) {
            ZipArchiveInputStream(bufferedStream).use { zipIn ->
                var entry: ZipArchiveEntry? = zipIn.nextEntry
                while (entry != null) {
                    processArchiveEntry(
                        entryName = entry.name,
                        isDirectory = entry.isDirectory,
                        readStream = zipIn,
                        destDir = destDir,
                        canonicalDestPath = canonicalDestPath
                    )
                    entry = zipIn.nextEntry
                }
            }
        } else {
            val decompressedStream: InputStream = when {
                isBzip2 -> BZip2CompressorInputStream(bufferedStream, true)
                isGzip -> GzipCompressorInputStream(bufferedStream, true)
                else -> bufferedStream
            }

            TarArchiveInputStream(BufferedInputStream(decompressedStream, 65536)).use { tarIn ->
                var entry: TarArchiveEntry? = tarIn.nextEntry
                while (entry != null) {
                    processArchiveEntry(
                        entryName = entry.name,
                        isDirectory = entry.isDirectory,
                        readStream = tarIn,
                        destDir = destDir,
                        canonicalDestPath = canonicalDestPath
                    )
                    entry = tarIn.nextEntry
                }
            }
        }
    }

    private fun processArchiveEntry(
        entryName: String,
        isDirectory: Boolean,
        readStream: InputStream,
        destDir: File,
        canonicalDestPath: String
    ) {
        var cleanName = entryName.trim()
        if (cleanName.startsWith("kokoro-multi-lang-v1_0/")) {
            cleanName = cleanName.removePrefix("kokoro-multi-lang-v1_0/")
        } else if (cleanName.startsWith("./kokoro-multi-lang-v1_0/")) {
            cleanName = cleanName.removePrefix("./kokoro-multi-lang-v1_0/")
        } else if (cleanName.startsWith("./")) {
            cleanName = cleanName.removePrefix("./")
        }

        if (cleanName.isBlank() || cleanName == ".") {
            return
        }

        val targetFile = File(destDir, cleanName)
        val canonicalTargetPath = targetFile.canonicalPath

        // Guard against Path Traversal (Zip-Slip / Tar-Slip)
        if (!canonicalTargetPath.startsWith(canonicalDestPath + File.separator) && canonicalTargetPath != canonicalDestPath) {
            throw SecurityException("Security error: archive entry is outside target directory: $cleanName")
        }

        if (isDirectory) {
            targetFile.mkdirs()
        } else {
            targetFile.parentFile?.mkdirs()
            targetFile.outputStream().use { output ->
                readStream.copyTo(output, bufferSize = 65536)
            }
        }
    }

    private suspend fun downloadFile(
        urlString: String,
        dest: File,
        onProgress: suspend (Int) -> Unit
    ) {
        val url = URL(urlString)
        val conn = url.openConnection() as HttpURLConnection
        conn.connect()
        val total = conn.contentLength.toLong()
        var downloaded = 0L

        conn.inputStream.use { input ->
            dest.outputStream().use { output ->
                val buffer = ByteArray(65536)
                var read: Int
                while (input.read(buffer).also { read = it } != -1) {
                    output.write(buffer, 0, read)
                    downloaded += read
                    if (total > 0L) onProgress(((downloaded * 100L) / total).toInt())
                }
            }
        }
    }

    private class ProgressInputStream(
        private val wrapped: InputStream,
        private val totalBytes: Long,
        private val onProgress: (Int) -> Unit
    ) : InputStream() {
        private var bytesRead: Long = 0L
        private var lastPercent: Int = -1

        override fun read(): Int {
            val b = wrapped.read()
            if (b != -1) {
                bytesRead++
                reportProgress()
            }
            return b
        }

        override fun read(b: ByteArray, off: Int, len: Int): Int {
            val count = wrapped.read(b, off, len)
            if (count != -1) {
                bytesRead += count
                reportProgress()
            }
            return count
        }

        private fun reportProgress() {
            if (totalBytes > 0) {
                val percent = ((bytesRead * 100) / totalBytes).toInt().coerceIn(0, 100)
                if (percent != lastPercent) {
                    lastPercent = percent
                    onProgress(percent)
                }
            }
        }

        override fun available(): Int = wrapped.available()
        override fun close() = wrapped.close()
    }
}
