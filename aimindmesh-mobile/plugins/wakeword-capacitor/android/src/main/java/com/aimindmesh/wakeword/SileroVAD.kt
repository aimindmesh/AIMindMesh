package com.aimindmesh.wakeword

import android.content.Context
import android.util.Log
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.io.File
import java.nio.FloatBuffer
import java.nio.LongBuffer
import java.util.Collections

/**
 * Silero VAD implementation using ONNX Runtime.
 * Ported to Kotlin for WakeWordDetector integration.
 */
class SileroVAD(private val context: Context) {

    companion object {
        private const val TAG = "SileroVAD"
        private const val SAMPLE_RATE = 16000L
        private const val WINDOW_SIZE = 512 // 32ms at 16kHz
    }

    private var ortEnv: OrtEnvironment? = null
    private var ortSession: OrtSession? = null
    var isLoaded = false
        private set

    // Internal state for streaming (Silero V4)
    // h, c are [2, 1, 64]
    private val hState = FloatArray(2 * 1 * 64)
    private val cState = FloatArray(2 * 1 * 64)
    // Buffer for V5 state construction [2 * 1 * 128]
    private val stateBuffer = FloatArray(2 * 1 * 128)
    
    // Config
    private var speechThreshold = 0.5f
    
    // Model Capabilities (Detected at load time)
    private var inputNames: Set<String> = emptySet()


    fun loadModel(modelFile: File): Boolean {
        return try {
            if (isLoaded) release()

            Log.i(TAG, "Loading VAD model from ${modelFile.absolutePath}")
            ortEnv = OrtEnvironment.getEnvironment()
            
            val options = OrtSession.SessionOptions()
            options.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
            // Use CPU execution provider (should be fast enough for VAD)
            
            ortSession = ortEnv?.createSession(modelFile.absolutePath, options)
            
            // Inspect model inputs
            inputNames = ortSession?.inputNames ?: emptySet()
            Log.i(TAG, "VAD loaded. Input names: $inputNames")
            
            reset()
            isLoaded = true
            Log.i(TAG, "Silero VAD loaded successfully")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load VAD model", e)
            false
        }
    }

    fun reset() {
        hState.fill(0f)
        cState.fill(0f)
    }

    fun release() {
        try {
            ortSession?.close()
            ortEnv?.close()
        } catch (e: Exception) {
            Log.e(TAG, "Error releasing VAD resources", e)
        }
        ortSession = null
        ortEnv = null
        isLoaded = false
    }

    /**
     * Process a chunk of audio.
     * Audio MUST be 512 samples long (WINDOW_SIZE).
     * If input is larger, caller must split it.
     */
    fun processChunk(chunk: FloatArray): Float {
        if (!isLoaded || ortSession == null) return 0f
        if (chunk.size != WINDOW_SIZE) {
            Log.w(TAG, "Invalid chunk size: ${chunk.size}. Expected $WINDOW_SIZE")
            return 0f
        }

        return try {
            // Inputs: input [1, 512], h [2, 1, 64], c [2, 1, 64], sr [1]
            val env = ortEnv ?: return 0f
            
            val inputTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(chunk), longArrayOf(1, WINDOW_SIZE.toLong()))
            val hTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(hState), longArrayOf(2, 1, 64))
            val cTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(cState), longArrayOf(2, 1, 64))
            val srTensor = OnnxTensor.createTensor(env, LongBuffer.wrap(longArrayOf(SAMPLE_RATE)), longArrayOf(1))
            var stateTensor: OnnxTensor? = null

            val inputs = HashMap<String, OnnxTensor>()
            
            // Expected names varies by model version:
            // v3/v4: "input", "h", "c", "sr"
            // v5/Optimized: "input", "state", "sr" (sometimes "state" combines h and c)
            // We map based on what the model asks for.

            // 1. Audio Input (Always required)
            if (inputNames.contains("input")) {
                inputs["input"] = inputTensor
            } else if (inputNames.isNotEmpty()) {
                // Fallback: Use first input if "input" not found (rare)
                inputs[inputNames.first()] = inputTensor
            }

            // 2. Hidden State
            if (inputNames.contains("h") && inputNames.contains("c")) {
                inputs["h"] = hTensor
                inputs["c"] = cTensor
            } else if (inputNames.contains("state")) {
                // Silero V5/Optimized: "state" is usually [2, 1, 128]
                // It combines h and c. We need to construct this tensor.
                val stateSize = 2 * 1 * 128
                val stateArr = stateBuffer
                
                // Interleave/Concat logic:
                // Typically Silero v5 packs it: [layers, batch, hidden*2]
                // h is [2, 1, 64], c is [2, 1, 64] -> state [2, 1, 128]
                // We copy h[i] then c[i] for each layer.
                
                var ptr = 0
                var hPtr = 0
                var cPtr = 0
                
                // For each layer (2 layers)
                for (i in 0 until 2) {
                     // Copy 64 floats from h
                     System.arraycopy(hState, hPtr, stateArr, ptr, 64)
                     ptr += 64
                     hPtr += 64
                     
                     // Copy 64 floats from c
                     System.arraycopy(cState, cPtr, stateArr, ptr, 64)
                     ptr += 64
                     cPtr += 64
                }
                
                stateTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(stateArr), longArrayOf(2, 1, 128))
                inputs["state"] = stateTensor!!
            }

            // 3. Sample Rate (Optional in some versions)
            if (inputNames.contains("sr")) {
                 inputs["sr"] = srTensor
            }

            val result = ortSession!!.run(inputs)

            // Outputs: output [1, 1], hn [2, 1, 64], cn [2, 1, 64]
            // OR output [1, 1], stateN [2, 1, 128]
            val probTensor = result[0].value as Array<FloatArray>
            val prob = probTensor[0][0]

            // Update internal state
            if (result.size() == 3 && inputNames.contains("h")) {
                // v4 output: prob, h, c
                val hOut = result[1].value as Array<Array<FloatArray>> // [2][1][64]
                val cOut = result[2].value as Array<Array<FloatArray>> // [2][1][64]
                
                var idx = 0
                for (i in 0 until 2) {
                    System.arraycopy(hOut[i][0], 0, hState, idx, 64)
                    System.arraycopy(cOut[i][0], 0, cState, idx, 64)
                    idx += 64
                }
            } else if (result.size() >= 2 && inputNames.contains("state")) {
                 // v5 output: prob, state
                 // stateOut is [2, 1, 128]
                 val stateOut = result[1].value as Array<Array<FloatArray>>
                 
                 var idx = 0
                 // Flatten back to hState and cState
                 // Assuming same packing: h then c per layer
                 for (i in 0 until 2) {
                     val layerState = stateOut[i][0] // [128]
                     // First 64 is h
                     System.arraycopy(layerState, 0, hState, idx, 64)
                     // Next 64 is c
                     System.arraycopy(layerState, 64, cState, idx, 64)
                     idx += 64
                 }
            }
            
            result.close()
            
            // Close all tensors
            inputTensor.close()
            hTensor.close()
            cTensor.close()
            srTensor.close()
            stateTensor?.close()
            
            prob
        } catch (e: Exception) {
            Log.e(TAG, "VAD Inference failed", e)
            0f
        }
    }
    
    fun isSpeech(prob: Float) = prob >= speechThreshold
}
