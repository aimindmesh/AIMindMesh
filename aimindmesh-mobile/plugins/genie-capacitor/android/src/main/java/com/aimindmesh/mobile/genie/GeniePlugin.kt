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
            put("board", caps["board"] as? String ?: "")
            put("ggufNpuSupported", caps["ggufNpuSupported"] as? Boolean ?: false)
            put("qairtSupported", caps["qairtSupported"] as? Boolean ?: false)
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

        val runtime = call.getString("runtime") ?: "auto"
        val contextLength = call.getInt("contextLength")

        scope.launch {
            try {
                val success = engine?.loadModel(modelPath, runtime, contextLength) ?: false
                if (success) {
                    call.resolve(modelInfo(JSObject().apply { put("success", true) }))
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
        call.resolve(modelInfo(JSObject().apply {
            put("loaded", loaded)
            if (path != null) put("modelPath", path)
        }))
    }

    /** The loaded model: name, precision, runtime (qairt | llama_cpp) and the unit it actually runs on */
    private fun modelInfo(into: JSObject): JSObject {
        val meta = engine?.getActiveModelMetadata() ?: emptyMap()
        return into.apply {
            put("modelName", meta["model_name"] as? String ?: "")
            put("isVision", meta["is_vision"] as? Boolean ?: false)
            put("precision", meta["precision"] as? String ?: "w4a16")
            engine?.getActiveRuntime()?.let { put("runtime", it) }
            engine?.getActiveUnit()?.let { put("computeUnit", it) }
            (meta["context_length"] as? Int)?.let { put("contextLength", it) }
        }
    }

    /** Prompt from the loaded model's chat template: { messages: [{role, content, imageCount?}], enableThinking } */
    @PluginMethod
    fun formatChat(call: PluginCall) {
        val array = call.getArray("messages")
        if (array == null) {
            call.reject("messages is required")
            return
        }
        val turns = (0 until array.length()).map { i ->
            val item = array.getJSONObject(i)
            val calls = item.optJSONArray("toolCalls")?.let { list ->
                (0 until list.length()).map { j ->
                    val c = list.getJSONObject(j)
                    GenieToolCall(c.optString("id", "call_$j"), c.optString("name"), c.optString("arguments", "{}"))
                }
            } ?: emptyList()
            GenieTurn(
                item.optString("role", "user"), item.optString("content", ""), item.optInt("imageCount", 0),
                calls, item.optString("toolCallId").ifEmpty { null }, item.optString("toolName").ifEmpty { null }
            )
        }
        val enableThinking = call.getBoolean("enableThinking") ?: false
        val tools = call.getString("tools")
        scope.launch {
            try {
                val prompt = engine?.formatChat(turns, enableThinking, tools)
                if (prompt != null) call.resolve(JSObject().apply { put("prompt", prompt) })
                else call.reject("No chat template for the loaded model")
            } catch (e: Exception) {
                Log.e(TAG, "formatChat failed", e)
                call.reject("formatChat failed: ${e.message}")
            }
        }
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
                        put("runtime", item["runtime"] as? String ?: "qairt")
                        put("npuReady", item["npuReady"] as? Boolean ?: false)
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
        // Images of this prompt (data URLs), written to files for the vision encoder
        val images = call.getArray("images")?.let { arr -> (0 until arr.length()).map { arr.getString(it) } } ?: emptyList()
        val grammar = call.getString("grammar")

        generationJob?.cancel()
        generationJob = scope.launch {
            try {
                val imagePaths = if (images.isEmpty()) emptyList()
                    else kotlinx.coroutines.withContext(Dispatchers.IO) { GenieChat.writeImages(java.io.File(context.cacheDir, "genie_images"), images) }
                val stream = engine?.generateStream(prompt, maxTokens, temperature, topP, stopSeqs, imagePaths, grammar)
                    ?: throw IllegalStateException("Genie engine not available")
                var finished = false
                stream.collect { chunk ->
                    val data = JSObject().apply {
                        put("text", chunk.text)
                        put("done", chunk.done)
                        chunk.profile?.let { p ->
                            put("profile", JSObject().apply {
                                put("ttftMs", p.ttftMs)
                                put("promptTokens", p.promptTokens)
                                put("generatedTokens", p.generatedTokens)
                                put("promptTimeMs", p.promptTimeMs)
                                put("decodeTimeMs", p.decodeTimeMs)
                                put("prefillSpeed", p.prefillSpeed)
                                put("decodingSpeed", p.decodingSpeed)
                                put("stopReason", p.stopReason ?: "")
                                put("mediaMs", p.mediaMs)
                                engine?.getActiveUnit()?.let { put("computeUnit", it) }
                            })
                        }
                    }
                    call.resolve(data)
                    if (chunk.done) {
                        finished = true
                        call.setKeepAlive(false)
                        if (activeStreamingCall === call) activeStreamingCall = null
                    }
                }
                if (!finished) {
                    // Aborted streams end without a Completed event: close the JS callback anyway
                    call.resolve(JSObject().apply {
                        put("text", "")
                        put("done", true)
                    })
                    call.setKeepAlive(false)
                    if (activeStreamingCall === call) activeStreamingCall = null
                }
            } catch (e: Exception) {
                Log.e(TAG, "Streaming generation failed", e)
                val errData = JSObject().apply {
                    put("done", true)
                    put("error", e.message ?: "Generation error")
                }
                call.resolve(errData)
                call.setKeepAlive(false)
                if (activeStreamingCall === call) activeStreamingCall = null
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
