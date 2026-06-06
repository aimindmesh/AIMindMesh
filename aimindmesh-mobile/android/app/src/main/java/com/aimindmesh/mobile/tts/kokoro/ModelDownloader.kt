package com.aimindmesh.mobile.tts.kokoro

import android.content.Context
import kotlinx.coroutines.*
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

object ModelDownloader {

    private const val BASE_URL =
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/"

    fun isModelReady(context: Context): Boolean {
        val destDir = File(context.filesDir, "kokoro-multi-lang-v1_0")
        val modelFile = File(destDir, "model.onnx")
        return modelFile.exists() && modelFile.length() > 100_000_000L
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
                val tarFile = File(sourceFilePath.replace("file://", ""))
                
                if (!tarFile.exists()) {
                    throw RuntimeException("File non trovato: $sourceFilePath")
                }

                withContext(Dispatchers.Main) { onProgress(50, "Estrazione file in corso...") }
                extractTarBz2(tarFile, context.filesDir)

                withContext(Dispatchers.Main) { onComplete(destDir) }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { onError(e.message ?: "Errore durante l'estrazione locale") }
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
        val modelFile = File(destDir, "model.onnx")

        if (modelFile.exists() && modelFile.length() > 100_000_000L) {
            onComplete(destDir)
            return
        }

        CoroutineScope(Dispatchers.IO).launch {
            try {
                destDir.mkdirs()
                val tarFile = File(context.cacheDir, "kokoro-multi-lang-v1_0.tar.bz2")

                // Download del bundle
                val url = "${BASE_URL}kokoro-multi-lang-v1_0.tar.bz2"
                downloadFile(url, tarFile) { progress ->
                    withContext(Dispatchers.Main) {
                        onProgress(progress, "Download in corso... $progress%")
                    }
                }

                // Estrazione tramite Runtime exec (tar di Android)
                withContext(Dispatchers.Main) { onProgress(99, "Estrazione file in corso...") }
                extractTarBz2(tarFile, context.filesDir)
                tarFile.delete()

                withContext(Dispatchers.Main) { onComplete(destDir) }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { onError(e.message ?: "Errore sconosciuto durante il download/estrazione") }
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

    private fun extractTarBz2(tarFile: File, destDir: File) {
        val process = Runtime.getRuntime().exec(
            arrayOf("tar", "xjf", tarFile.absolutePath, "-C", destDir.absolutePath)
        )
        val exitCode = process.waitFor()
        if (exitCode != 0) {
            val error = process.errorStream.bufferedReader().readText()
            throw RuntimeException("Estrazione fallita (exit $exitCode): $error")
        }
    }
}
