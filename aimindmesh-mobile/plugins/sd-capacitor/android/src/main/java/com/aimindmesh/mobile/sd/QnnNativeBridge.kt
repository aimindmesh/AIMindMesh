package com.aimindmesh.mobile.sd

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.File

/**
 * Qualcomm QNN / Hexagon HTP native runtime bridge and quantization interface.
 * Connects directly to libqnn_sd_jni.so for on-device NPU graph execution.
 */
class QnnNativeBridge(private val context: Context) {
    companion object {
        private const val TAG = "QnnNativeBridge"
        private var isJniLoaded = false

        init {
            try {
                System.loadLibrary("qnn_sd_jni")
                isJniLoaded = true
                Log.i(TAG, "Loaded native QNN SD JNI bridge: libqnn_sd_jni.so")
            } catch (e: Throwable) {
                Log.w(TAG, "Failed to load libqnn_sd_jni.so", e)
            }
        }
    }

    private external fun nativeInit(modelDirPath: String, nativeLibDir: String): Boolean
    private external fun nativeIsReady(): Boolean
    private external fun nativeRunTextEncoder(tokens: IntArray): FloatArray?
    private external fun nativeRunUnet(latent: FloatArray, timestep: Float, textEmb: FloatArray): FloatArray?
    private external fun nativeRunVae(latent: FloatArray): ByteArray?
    private external fun nativeRelease()

    private var modelDir: File? = null
    private var isNativeReady = false

    /**
     * Load model configuration and initialize native QNN context binaries.
     */
    fun initializeFromDirectory(dir: File): Boolean {
        modelDir = dir
        try {
            com.geniex.sdk.GenieXSdk.getInstance().init(
                context,
                object : com.geniex.sdk.GenieXSdk.InitCallback {
                    override fun onSuccess() {
                        Log.i(TAG, "GenieXSdk initialized for QNN SD NPU pipeline")
                    }
                    override fun onFailure(reason: String) {
                        Log.w(TAG, "GenieXSdk init callback: $reason")
                    }
                }
            )

            val nativeLibDirFile = File(context.applicationInfo.nativeLibraryDir)
            if (nativeLibDirFile.exists() && nativeLibDirFile.isDirectory) {
                nativeLibDirFile.listFiles()?.forEach { libFile ->
                    if (libFile.name.startsWith("libgeniex_plugin_") && libFile.name.endsWith(".so")) {
                        try {
                            com.geniex.sdk.GenieXSdk.getInstance().registerPlugin(libFile.absolutePath)
                        } catch (e: Exception) {
                            Log.w(TAG, "Plugin registration exception for ${libFile.name}", e)
                        }
                    }
                }
            }
        } catch (e: Throwable) {
            Log.w(TAG, "GenieXSdk initialization check in SD bridge", e)
        }

        if (isJniLoaded) {
            try {
                val nativeLibDir = context.applicationInfo.nativeLibraryDir ?: ""
                isNativeReady = nativeInit(dir.absolutePath, nativeLibDir)
                Log.i(TAG, "nativeInit for QNN context binary returned: $isNativeReady (nativeLibDir: $nativeLibDir)")
                if (isNativeReady) {
                    return true
                }
            } catch (e: Throwable) {
                Log.e(TAG, "Exception in nativeInit", e)
            }
        }
        return isNativeReady
    }

    fun isReady(): Boolean = isNativeReady

    /**
     * Run CLIP Text Encoder graph (text_encoder.bin): tokens [1, 77] -> text_embedding [1, 77, 1024]
     */
    fun runTextEncoder(tokens: IntArray): FloatArray {
        if (isJniLoaded && isNativeReady) {
            val result = nativeRunTextEncoder(tokens)
            if (result != null && result.isNotEmpty()) {
                return result
            }
        }
        Log.w(TAG, "Native TextEncoder returned null, using initialized zero embedding")
        return FloatArray(77 * 1024)
    }

    /**
     * Run UNet graph (unet.bin): [1, 64, 64, 4] -> output_latent [1, 64, 64, 4]
     */
    fun runUnet(
        latent: FloatArray,
        timestep: Float,
        textEmbedding: FloatArray
    ): FloatArray {
        if (isJniLoaded && isNativeReady) {
            val result = nativeRunUnet(latent, timestep, textEmbedding)
            if (result != null && result.isNotEmpty()) {
                return result
            }
        }
        Log.w(TAG, "Native UNet returned null")
        return FloatArray(latent.size)
    }

    /**
     * Run VAE Decoder graph (vae.bin): latent [1, 64, 64, 4] -> RGB image [512, 512, 3] bytes
     */
    fun runVaeDecoder(latent: FloatArray): ByteArray {
        if (isJniLoaded && isNativeReady) {
            val result = nativeRunVae(latent)
            if (result != null && result.isNotEmpty()) {
                return result
            }
        }
        Log.w(TAG, "Native VAE returned null")
        return ByteArray(512 * 512 * 3)
    }

    fun release() {
        if (isJniLoaded) {
            try {
                nativeRelease()
                isNativeReady = false
            } catch (e: Throwable) {
                Log.e(TAG, "Exception in nativeRelease", e)
            }
        }
    }
}
