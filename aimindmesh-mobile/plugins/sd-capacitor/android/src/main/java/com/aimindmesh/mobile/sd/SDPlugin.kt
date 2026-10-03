package com.aimindmesh.mobile.sd

import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.File
import java.io.FileOutputStream

private const val TAG = "SDPlugin"

@CapacitorPlugin(name = "SD")
class SDPlugin : Plugin() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var engine: SDEngine? = null

    override fun load() {
        super.load()
        engine = SDEngine(context)
        Log.i(TAG, "SDPlugin initialized with Qualcomm NPU support")
    }

    @PluginMethod
    fun getCapabilities(call: PluginCall) {
        val caps = engine?.detectCapabilities() ?: emptyMap()
        val result = JSObject().apply {
            put("hasNpu", caps["hasNpu"] as? Boolean ?: false)
            put("npuArch", caps["npuArch"] as? String ?: "none")
            put("socModel", caps["socModel"] as? String ?: "")
            val backends = JSArray()
            (caps["supportedBackends"] as? List<*>)?.forEach { backends.put(it) }
            put("supportedBackends", backends)
        }
        call.resolve(result)
    }

    @PluginMethod
    fun loadModel(call: PluginCall) {
        val modelPath = call.getString("modelPath")
        if (modelPath == null) {
            call.reject("modelPath is required")
            return
        }

        val backend = call.getString("backend") ?: "npu"
        scope.launch {
            try {
                val success = engine?.loadModel(modelPath, backend) ?: false
                if (success) {
                    call.resolve(JSObject().apply {
                        put("success", true)
                        putModelInfo(this)
                    })
                } else {
                    call.reject("Failed to load SD model on $backend (path: $modelPath)")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error loading SD model", e)
                call.reject("Error loading SD model: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun unloadModel(call: PluginCall) {
        scope.launch {
            val success = engine?.unloadModel() ?: true
            call.resolve(JSObject().apply { put("success", success) })
        }
    }

    @PluginMethod
    fun isLoaded(call: PluginCall) {
        val loaded = engine?.isLoaded() ?: false
        val path = engine?.getActiveModelPath()
        val result = JSObject().apply {
            put("loaded", loaded)
            if (path != null) put("modelPath", path)
            if (loaded) putModelInfo(this)
        }
        call.resolve(result)
    }

    /** What the loaded package can do: the UI hides editing/upscaling it does not support */
    private fun putModelInfo(target: JSObject) {
        val e = engine ?: return
        val info = e.getModelInfo()
        target.put("predictionType", e.getPredictionType().id)
        target.put("hasVaeEncoder", info.hasVaeEncoder)
        target.put("hasSuperResolution", info.hasSuperResolution)
        target.put("textEmbeddingDim", info.embedDim)
        target.put("unetQuantized", info.unetQuantized)
    }

    @PluginMethod
    fun copyFile(call: PluginCall) {
        val sourcePath = call.getString("sourcePath")
        val fileName = call.getString("fileName")

        if (sourcePath == null || fileName == null) {
            call.reject("sourcePath and fileName are required")
            return
        }

        // Bundles are GBs: extract off the shared Capacitor plugin thread
        scope.launch(Dispatchers.IO) { copyFileBlocking(call, sourcePath, fileName) }
    }

    private fun copyFileBlocking(call: PluginCall, sourcePath: String, fileName: String) {
        try {
            val filesDir = context.filesDir
            val isZip = fileName.lowercase().endsWith(".zip") || sourcePath.lowercase().endsWith(".zip")

            if (isZip) {
                var folderName = fileName
                if (folderName.lowercase().endsWith(".zip")) {
                    folderName = folderName.substring(0, folderName.length - 4)
                }
                val targetDir = File(filesDir, folderName)
                if (targetDir.exists()) {
                    SDFileUtils.deleteRecursively(targetDir)
                }
                targetDir.mkdirs()

                val inputStream = SDFileUtils.openInputStream(context, sourcePath)
                if (inputStream == null) {
                    call.reject("Could not open input stream for zip source: $sourcePath")
                    return
                }

                val extracted = SDFileUtils.extractZipStream(inputStream, targetDir)
                if (!extracted) {
                    call.reject("Failed to extract Stable Diffusion ZIP bundle to ${targetDir.absolutePath}")
                    return
                }

                val ret = JSObject().apply {
                    put("path", targetDir.absolutePath)
                }
                call.resolve(ret)
                return
            }

            val destFile = File(filesDir, fileName)
            destFile.parentFile?.mkdirs()

            val inputStream = SDFileUtils.openInputStream(context, sourcePath)
            if (inputStream == null) {
                call.reject("Could not open input stream from source: $sourcePath")
                return
            }

            inputStream.use { input ->
                java.io.FileOutputStream(destFile).use { fos ->
                    val buffer = ByteArray(64 * 1024)
                    var len: Int
                    while (input.read(buffer).also { len = it } > 0) {
                        fos.write(buffer, 0, len)
                    }
                }
            }

            val ret = JSObject().apply {
                put("path", destFile.absolutePath)
            }
            call.resolve(ret)
        } catch (e: Exception) {
            Log.e(TAG, "Error copying SD model file", e)
            call.reject("Error copying SD model file: ${e.message}")
        }
    }

    @PluginMethod
    fun generateImage(call: PluginCall) {
        val prompt = call.getString("prompt")
        if (prompt == null) {
            call.reject("prompt is required")
            return
        }

        if (engine?.isLoaded() != true) {
            call.reject("No Stable Diffusion model loaded. Please import and select a model in Settings > Vision & Image Creation.")
            return
        }

        val request = SDRequest(
            prompt = prompt,
            negativePrompt = call.getString("negativePrompt") ?: "",
            sourceImage = call.getString("sourceImage"),
            strength = call.getFloat("strength") ?: 0.65f,
            steps = call.getInt("steps") ?: 25,
            cfgScale = call.getFloat("cfgScale") ?: 7.5f,
            seed = call.getDouble("seed")?.toLong() ?: -1L,
            aspectRatio = call.getString("aspectRatio") ?: "1:1",
            upscale = call.getInt("upscale") ?: 1,
            sampler = SamplerKind.parse(call.getString("sampler"))
        )

        scope.launch {
            try {
                val result = engine?.generateImage(request) { step, totalSteps, timePerStep ->
                    notifyListeners("sdProgress", JSObject().apply {
                        put("step", step)
                        put("totalSteps", totalSteps)
                        put("timePerStep", timePerStep)
                    })
                }
                if (result != null) {
                    call.resolve(JSObject().apply { result.forEach { (key, value) -> put(key, value) } })
                } else {
                    call.reject("Failed to generate image")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Image generation error", e)
                call.reject("Image generation failed: ${e.message}")
            }
        }
    }
}
