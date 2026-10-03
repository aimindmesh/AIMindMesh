package com.aimindmesh.mobile.sd

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.File

/** Shapes and optional parts of the loaded package, as the native engine read them from the binaries. */
data class SDModelInfo(
    val seqLen: Int = 77,
    val embedDim: Int = 1024,
    val latentChannels: Int = 4,
    val latentHeight: Int = 64,
    val latentWidth: Int = 64,
    val imageWidth: Int = 512,
    val imageHeight: Int = 512,
    val timestepMax: Int = 999,
    val hasVaeEncoder: Boolean = false,
    val hasSuperResolution: Boolean = false,
    val superResolutionWidth: Int = 0,
    val superResolutionHeight: Int = 0,
    val unetQuantized: Boolean = false
) {
    val latentSize get() = latentChannels * latentHeight * latentWidth

    companion object {
        fun parse(json: String): SDModelInfo = JSONObject(json).run {
            SDModelInfo(
                seqLen = optInt("seqLen", 77),
                embedDim = optInt("embedDim", 1024),
                latentChannels = optInt("latentChannels", 4),
                latentHeight = optInt("latentHeight", 64),
                latentWidth = optInt("latentWidth", 64),
                imageWidth = optInt("imageWidth", 512),
                imageHeight = optInt("imageHeight", 512),
                timestepMax = optDouble("timestepMax", 999.0).toInt(),
                hasVaeEncoder = optBoolean("hasVaeEncoder", false),
                hasSuperResolution = optBoolean("hasSuperResolution", false),
                superResolutionWidth = optInt("superResolutionWidth", 0),
                superResolutionHeight = optInt("superResolutionHeight", 0),
                unetQuantized = optBoolean("unetQuantized", false)
            )
        }
    }
}

/**
 * Qualcomm QNN / Hexagon HTP runtime bridge (libqnn_sd_jni.so). Latents are NHWC floats,
 * images RGB bytes; the native side converts to whatever each graph declares.
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
    private external fun nativeModelInfo(): String
    private external fun nativeRunTextEncoder(tokens: IntArray): FloatArray?
    private external fun nativeRunUnet(latent: FloatArray, timestep: Float, textEmb: FloatArray): FloatArray?
    private external fun nativeRunVae(latent: FloatArray): ByteArray?
    private external fun nativeRunVaeEncoder(rgbBytes: ByteArray): FloatArray?
    private external fun nativeHasVaeEncoder(): Boolean
    private external fun nativeRunSuperResolution(rgb: ByteArray): ByteArray?
    private external fun nativeHasSuperResolution(): Boolean
    private external fun nativeRelease()

    /** Loads the context binaries of a package directory onto the NPU. */
    fun initializeFromDirectory(dir: File): Boolean {
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
            File(context.applicationInfo.nativeLibraryDir).listFiles()?.forEach { libFile ->
                if (libFile.name.startsWith("libgeniex_plugin_") && libFile.name.endsWith(".so")) {
                    try {
                        com.geniex.sdk.GenieXSdk.getInstance().registerPlugin(libFile.absolutePath)
                    } catch (e: Exception) {
                        Log.w(TAG, "Plugin registration exception for ${libFile.name}", e)
                    }
                }
            }
        } catch (e: Throwable) {
            Log.w(TAG, "GenieXSdk initialization check in SD bridge", e)
        }

        if (!isJniLoaded) return false
        return try {
            val ready = nativeInit(dir.absolutePath, context.applicationInfo.nativeLibraryDir ?: "")
            Log.i(TAG, "nativeInit returned $ready")
            ready
        } catch (e: Throwable) {
            Log.e(TAG, "Exception in nativeInit", e)
            false
        }
    }

    // The QNN engine is a process-wide native singleton: ask it, so a bridge created after an
    // Activity recreation sees the pipeline loaded by the previous one
    fun isReady(): Boolean = isJniLoaded && nativeIsReady()

    fun modelInfo(): SDModelInfo = SDModelInfo.parse(if (isReady()) nativeModelInfo() else "{}")

    fun runTextEncoder(tokens: IntArray): FloatArray =
        (if (isReady()) nativeRunTextEncoder(tokens) else null)
            ?: throw IllegalStateException("Stable Diffusion text encoder failed on the NPU")

    fun runUnet(latent: FloatArray, timestep: Float, textEmbedding: FloatArray): FloatArray =
        (if (isReady()) nativeRunUnet(latent, timestep, textEmbedding) else null)
            ?: throw IllegalStateException("Stable Diffusion UNet failed on the NPU")

    /** RGB bytes of the decoded image */
    fun runVaeDecoder(latent: FloatArray): ByteArray =
        (if (isReady()) nativeRunVae(latent) else null)
            ?: throw IllegalStateException("Stable Diffusion VAE decoder failed on the NPU")

    /** Latent of an RGB image (image editing) */
    fun runVaeEncoder(rgbBytes: ByteArray): FloatArray =
        (if (hasVaeEncoder()) nativeRunVaeEncoder(rgbBytes) else null)
            ?: throw IllegalStateException("Stable Diffusion VAE encoder failed on the NPU")

    fun hasVaeEncoder(): Boolean = isReady() && nativeHasVaeEncoder()

    /** Real-ESRGAN on the NPU; null when the model is missing or fails (callers fall back to filtering). */
    fun runSuperResolution(rgb: ByteArray): ByteArray? {
        if (!hasSuperResolution()) return null
        return nativeRunSuperResolution(rgb).also { if (it == null) Log.e(TAG, "Real-ESRGAN failed on the NPU") }
    }

    fun hasSuperResolution(): Boolean = isReady() && nativeHasSuperResolution()

    fun release() {
        if (!isJniLoaded) return
        try {
            nativeRelease()
        } catch (e: Throwable) {
            Log.e(TAG, "Exception in nativeRelease", e)
        }
    }
}
