package com.aimindmesh.mobile.genie

import android.content.Context
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.util.zip.ZipInputStream

object GenieConfigUtils {
    private const val TAG = "GenieConfigUtils"

    fun detectNpuCapabilities(): Map<String, Any> {
        val soc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) Build.SOC_MODEL else ""
        val npuArch = HexagonSoc.arch(soc, Build.BOARD, Build.HARDWARE)
        val hasNpu = npuArch != "none"
        val runtimes = if (hasNpu) listOf("cpu", "gpu", "npu") else listOf("cpu")
        return mapOf(
            "hasNpu" to hasNpu,
            "npuArch" to npuArch,
            "supportedRuntimes" to runtimes,
            "socModel" to soc.ifEmpty { Build.HARDWARE },
            "board" to Build.BOARD,
            // GGUF files run on the NPU of any Hexagon v68+ (llama_cpp runtime); QAIRT bundles only on v79/v81
            "ggufNpuSupported" to hasNpu,
            "qairtSupported" to HexagonSoc.qairtSupported(npuArch)
        )
    }

    fun generateHtpConfig(context: Context): File {
        val caps = detectNpuCapabilities()
        val arch = caps["npuArch"] as? String ?: "v79"
        val socId = when (arch) {
            "v79" -> 69  // Snapdragon 8 Elite (SM8750)
            "v75" -> 57  // Snapdragon 8 Gen 3 (SM8650)
            "v73" -> 43  // Snapdragon 8 Gen 2 (SM8550)
            else -> 69
        }

        val json = """
        {
            "devices": [
                {
                    "soc_model": $socId,
                    "dsp_arch": "$arch",
                    "cores": [
                        {
                            "core_id": 0,
                            "perf_profile": "burst",
                            "rpc_control_latency": 100
                        }
                    ]
                }
            ],
            "memory": {
                "mem_type": "shared_buffer"
            },
            "groupContext": {
                "share_resources": true
            }
        }
        """.trimIndent()

        val configFile = File(context.cacheDir, "htp_config.json")
        configFile.writeText(json)
        Log.i(TAG, "Generated HTP backend config for $arch (SoC $socId) at: ${configFile.absolutePath}")
        return configFile
    }

    fun getFileNameFromUri(context: Context, uriString: String): String {
        if (!uriString.startsWith("content://")) {
            val f = File(uriString)
            return if (f.name.isNotEmpty()) f.name else "model_${System.currentTimeMillis()}.zip"
        }
        val uri = Uri.parse(uriString)
        var name: String? = null
        try {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (index >= 0) {
                        name = cursor.getString(index)
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to query display name from content resolver", e)
        }
        if (name.isNullOrEmpty()) {
            val path = uri.lastPathSegment ?: "model_${System.currentTimeMillis()}"
            name = path.substringAfterLast('/')
        }
        return name ?: "model_${System.currentTimeMillis()}.zip"
    }

    suspend fun extractZipStream(inputStream: InputStream, targetDir: File): Boolean = withContext(Dispatchers.IO) {
        try {
            if (!targetDir.exists()) {
                targetDir.mkdirs()
            }
            Log.i(TAG, "Extracting Qualcomm model bundle to ${targetDir.absolutePath}...")

            ZipInputStream(BufferedInputStream(inputStream)).use { zis ->
                var entry = zis.nextEntry
                val buffer = ByteArray(128 * 1024)
                while (entry != null) {
                    val newFile = File(targetDir, entry.name)
                    if (!newFile.canonicalPath.startsWith(targetDir.canonicalPath)) {
                        throw SecurityException("Zip entry is outside target dir: ${entry.name}")
                    }
                    if (entry.isDirectory) {
                        newFile.mkdirs()
                    } else {
                        newFile.parentFile?.mkdirs()
                        FileOutputStream(newFile).use { fos ->
                            var len: Int
                            while (zis.read(buffer).also { len = it } > 0) {
                                fos.write(buffer, 0, len)
                            }
                        }
                    }
                    zis.closeEntry()
                    entry = zis.nextEntry
                }
            }

            val subFiles = targetDir.listFiles()
            if (subFiles != null && subFiles.size == 1 && subFiles[0].isDirectory) {
                val innerDir = subFiles[0]
                innerDir.listFiles()?.forEach { f ->
                    val dest = File(targetDir, f.name)
                    if (dest.exists()) dest.deleteRecursively()
                    f.renameTo(dest)
                }
                innerDir.delete()
            }

            Log.i(TAG, "Extraction completed successfully to ${targetDir.name}")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to extract zip stream", e)
            false
        }
    }

    fun findGenieModelDirectory(context: Context, basePath: File): File? {
        if (!basePath.exists()) return null

        if (basePath.isFile) {
            if (basePath.name == "genie_config.json") {
                return basePath.parentFile
            }
            if (basePath.name.endsWith(".zip")) {
                val bundleName = basePath.nameWithoutExtension.replace("[^a-zA-Z0-9_.-]".toRegex(), "_")
                val extractedDir = File(context.filesDir, "models/genie/$bundleName")
                return findGenieModelDirectory(context, extractedDir)
            }
            return null
        }

        val directConfig = File(basePath, "genie_config.json")
        if (directConfig.exists()) return basePath

        var foundDir: File? = null
        basePath.walkTopDown().maxDepth(3).forEach { file ->
            if (foundDir == null && file.isFile && file.name == "genie_config.json") {
                foundDir = file.parentFile
            }
        }
        return foundDir
    }

    fun parseModelMetadata(modelDir: File): Map<String, Any?> {
        val metadataFile = File(modelDir, "metadata.json")
        val hasVision = File(modelDir, "vision_encoder.bin").exists() || File(modelDir, "visual.bin").exists()

        if (!metadataFile.exists()) {
            return mapOf(
                "model_id" to modelDir.name,
                "model_name" to modelDir.name,
                "precision" to "w4a16",
                "is_vision" to hasVision
            )
        }

        return try {
            val json = JSONObject(metadataFile.readText())
            mapOf(
                "model_id" to json.optString("model_id", modelDir.name),
                "model_name" to json.optString("model_name", modelDir.name),
                "precision" to json.optString("precision", "w4a16"),
                "runtime" to json.optString("runtime", "geniex_qairt"),
                "is_vision" to (hasVision || json.optJSONObject("model_files")?.has("vision_encoder.bin") == true)
            )
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse metadata.json", e)
            mapOf(
                "model_id" to modelDir.name,
                "model_name" to modelDir.name,
                "precision" to "w4a16",
                "is_vision" to hasVision
            )
        }
    }

    /** Context the bundle was exported with (genie_config.json dialog.context.size), fixed for QAIRT */
    fun bundleContextSize(modelDir: File): Int? = try {
        JSONObject(File(modelDir, "genie_config.json").readText())
            .optJSONObject("dialog")?.optJSONObject("context")?.optInt("size", 0)?.takeIf { it > 0 }
    } catch (e: Exception) {
        null
    }

    fun resolveGenieConfig(context: Context, modelDir: File): String {
        val configFile = File(modelDir, "genie_config.json")
        if (!configFile.exists()) {
            throw IllegalStateException("genie_config.json not found in ${modelDir.absolutePath}")
        }

        val json = JSONObject(configFile.readText())
        val dialog = json.getJSONObject("dialog")

        if (dialog.has("tokenizer")) {
            val tokenizerObj = dialog.getJSONObject("tokenizer")
            val tokenPath = tokenizerObj.optString("path", "tokenizer.json")
            val absTokenPath = if (File(tokenPath).isAbsolute) tokenPath else File(modelDir, tokenPath).absolutePath
            tokenizerObj.put("path", absTokenPath)
        }

        if (dialog.has("engine")) {
            val engineObj = dialog.getJSONObject("engine")
            if (engineObj.has("backend")) {
                val backendObj = engineObj.getJSONObject("backend")
                val extConfig = File(modelDir, backendObj.optString("extensions", "htp_backend_ext_config.json"))
                if (extConfig.exists()) {
                    backendObj.put("extensions", extConfig.absolutePath)
                } else {
                    val autoHtp = generateHtpConfig(context)
                    backendObj.put("extensions", autoHtp.absolutePath)
                }

                if (backendObj.has("QnnHtp")) {
                    val qnnHtp = backendObj.getJSONObject("QnnHtp")
                    qnnHtp.put("use-mmap", true)
                    qnnHtp.put("poll", true)
                    qnnHtp.put("cpu-mask", "0xe0")
                }
            }

            if (engineObj.has("model")) {
                val modelObj = engineObj.getJSONObject("model")
                if (modelObj.has("binary")) {
                    val binaryObj = modelObj.getJSONObject("binary")
                    val ctxBins = binaryObj.optJSONArray("ctx-bins") ?: JSONArray()
                    val resolvedBins = JSONArray()
                    for (i in 0 until ctxBins.length()) {
                        val binName = ctxBins.getString(i)
                        val absBin = if (File(binName).isAbsolute) binName else File(modelDir, binName).absolutePath
                        resolvedBins.put(absBin)
                    }
                    binaryObj.put("ctx-bins", resolvedBins)
                }
            }
        }

        if (dialog.has("embedding")) {
            val embeddingObj = dialog.getJSONObject("embedding")
            val lutPath = embeddingObj.optString("lut-path", "embedding_weights.raw")
            val absLut = if (File(lutPath).isAbsolute) lutPath else File(modelDir, lutPath).absolutePath
            embeddingObj.put("lut-path", absLut)
        }

        return json.toString()
    }

    fun getFolderSize(dir: File): Long {
        var size = 0L
        dir.walkTopDown().forEach { file ->
            if (file.isFile) size += file.length()
        }
        return size
    }
}
