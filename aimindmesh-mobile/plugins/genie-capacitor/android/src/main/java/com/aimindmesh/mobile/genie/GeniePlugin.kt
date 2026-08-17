package com.aimindmesh.mobile.genie

import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.File

private const val TAG = "GeniePlugin"

@CapacitorPlugin(name = "Genie")
class GeniePlugin : Plugin() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var engine: GenieEngine? = null
    private var activeStreamingCall: PluginCall? = null
    private var generationJob: Job? = null

    override fun load() {
        super.load()
        engine = GenieEngine(context)
        Log.i(TAG, "GeniePlugin initialized with Qualcomm NPU support")
    }

    @PluginMethod
    fun getCapabilities(call: PluginCall) {
        val caps = engine?.detectNpuCapabilities() ?: emptyMap()
        val result = JSObject().apply {
            put("hasNpu", caps["hasNpu"] as? Boolean ?: false)
            put("npuArch", caps["npuArch"] as? String ?: "none")
            put("socModel", caps["socModel"] as? String ?: "")
            val runtimes = JSArray()
            (caps["supportedRuntimes"] as? List<*>)?.forEach { runtimes.put(it) }
            put("supportedRuntimes", runtimes)
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

        val runtime = call.getString("runtime") ?: "npu"
        val temperature = call.getFloat("temperature") ?: 0.7f
        val topP = call.getFloat("topP") ?: 0.9f

        scope.launch {
            try {
                val success = engine?.loadModel(modelPath, runtime, temperature, topP) ?: false
                if (success) {
                    val meta = engine?.getActiveModelMetadata() ?: emptyMap()
                    call.resolve(JSObject().apply {
                        put("success", true)
                        put("modelName", meta["model_name"] as? String ?: "")
                        put("isVision", meta["is_vision"] as? Boolean ?: false)
                        put("precision", meta["precision"] as? String ?: "w4a16")
                    })
                } else {
                    call.reject("Failed to load model on Qualcomm $runtime")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error loading model", e)
                call.reject("Error loading model: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun unloadModel(call: PluginCall) {
        scope.launch {
            generationJob?.cancel()
            val success = engine?.unloadModel() ?: true
            call.resolve(JSObject().apply { put("success", success) })
        }
    }

    @PluginMethod
    fun isLoaded(call: PluginCall) {
        val loaded = engine?.isLoaded() ?: false
        val path = engine?.getActiveModelPath()
        val meta = engine?.getActiveModelMetadata() ?: emptyMap()
        val result = JSObject().apply {
            put("loaded", loaded)
            if (path != null) put("modelPath", path)
            put("modelName", meta["model_name"] as? String ?: "")
            put("isVision", meta["is_vision"] as? Boolean ?: false)
            put("precision", meta["precision"] as? String ?: "w4a16")
        }
        call.resolve(result)
    }

    @PluginMethod
    fun listLocalModels(call: PluginCall) {
        scope.launch {
            try {
                val list = engine?.listLocalModels() ?: emptyList()
                val modelsArr = JSArray()
                list.forEach { item ->
                    val obj = JSObject().apply {
                        put("model_id", item["model_id"] as? String ?: "")
                        put("model_name", item["model_name"] as? String ?: "")
                        put("path", item["path"] as? String ?: "")
                        put("precision", item["precision"] as? String ?: "w4a16")
                        put("runtime", item["runtime"] as? String ?: "geniex_qairt")
                        put("is_vision", item["is_vision"] as? Boolean ?: false)
                        put("sizeBytes", item["sizeBytes"] as? Long ?: 0L)
                    }
                    modelsArr.put(obj)
                }
                call.resolve(JSObject().apply { put("models", modelsArr) })
            } catch (e: Exception) {
                Log.e(TAG, "Failed to list local Genie models", e)
                call.reject("Failed to list local models: ${e.message}")
            }
        }
    }

    @PluginMethod(returnType = PluginMethod.RETURN_CALLBACK)
    fun generateStream(call: PluginCall) {
        val prompt = call.getString("prompt")
        if (prompt == null) {
            call.reject("prompt is required")
            return
        }

        call.setKeepAlive(true)
        activeStreamingCall = call

        val maxTokens = call.getInt("maxTokens") ?: 2048
        val temperature = call.getFloat("temperature") ?: 0.7f
        val topP = call.getFloat("topP") ?: 0.9f

        val stopSeqs = mutableListOf<String>()
        call.getArray("stopSequences")?.let { arr ->
            for (i in 0 until arr.length()) {
                stopSeqs.add(arr.getString(i))
            }
        }

        generationJob?.cancel()
        generationJob = scope.launch {
            try {
                engine?.generateStream(prompt, maxTokens, temperature, topP, stopSeqs)?.collect { (token, isDone) ->
                    val data = JSObject().apply {
                        put("text", token)
                        put("done", isDone)
                    }
                    call.resolve(data)
                    if (isDone) {
                        call.setKeepAlive(false)
                        activeStreamingCall = null
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Streaming generation failed", e)
                val errData = JSObject().apply {
                    put("done", true)
                    put("error", e.message ?: "Generation error")
                }
                call.resolve(errData)
                call.setKeepAlive(false)
                activeStreamingCall = null
            }
        }
    }

    @PluginMethod
    fun abortGeneration(call: PluginCall) {
        generationJob?.cancel()
        engine?.abortGeneration()
        activeStreamingCall?.let {
            val abortData = JSObject().apply {
                put("done", true)
                put("error", "Generation aborted by user")
            }
            it.resolve(abortData)
            it.setKeepAlive(false)
        }
        activeStreamingCall = null
        call.resolve(JSObject().apply { put("success", true) })
    }
}
