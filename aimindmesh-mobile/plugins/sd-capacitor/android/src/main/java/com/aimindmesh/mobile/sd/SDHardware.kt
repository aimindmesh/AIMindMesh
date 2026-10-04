package com.aimindmesh.mobile.sd

import org.json.JSONObject

/** A package compiled for another Hexagon NPU: QNN context binaries only run on the version they target. */
class IncompatiblePackageException(message: String) : IllegalStateException(message)

/**
 * Hexagon NPU versions of the Snapdragon chips, and the check that a Stable Diffusion package was
 * compiled for this phone's NPU.
 */
object HexagonArch {
    private data class Chip(val soc: String, val board: String, val arch: String, val name: String)

    private val CHIPS = listOf(
        Chip("sm8850", "canoe", "v81", "Snapdragon 8 Elite Gen 5"),
        Chip("sm8750", "sun", "v79", "Snapdragon 8 Elite"),
        Chip("sm8650", "pineapple", "v75", "Snapdragon 8 Gen 3"),
        Chip("sm8550", "kalama", "v73", "Snapdragon 8 Gen 2"),
    )

    /** "v73", "v79"... from Build.SOC_MODEL / BOARD / HARDWARE; null for chips not listed. */
    fun forDevice(socModel: String, board: String, hardware: String): String? {
        val soc = socModel.lowercase()
        val b = board.lowercase()
        val hw = hardware.lowercase()
        return CHIPS.firstOrNull { soc.startsWith(it.soc) || hw.contains(it.soc) || b == it.board }?.arch
    }

    /** QNN HTP stub the phone needs, e.g. libQnnHtpV73Stub.so */
    fun stubLibrary(arch: String): String = "libQnnHtp${arch.uppercase()}Stub.so"

    /** Hexagon version a package targets: "hexagon" (our exports) or chipset_attributes.htp_version (Qualcomm). */
    fun forPackage(metadataJson: String): String? {
        val meta = JSONObject(metadataJson)
        meta.optString("hexagon", "").trim().lowercase().takeIf { Regex("v\\d+").matches(it) }?.let { return it }
        val htp = meta.optJSONObject("chipset_attributes")?.optInt("htp_version", 0) ?: 0
        return if (htp > 0) "v$htp" else null
    }

    /** Why the package cannot run on this phone, or null when it can (or either side is unknown). */
    fun incompatibility(packageArch: String?, deviceArch: String?): String? {
        if (packageArch == null || deviceArch == null || packageArch == deviceArch) return null
        return "This Stable Diffusion package was compiled for the Hexagon $packageArch NPU (${chipName(packageArch)}), " +
            "this phone has $deviceArch (${chipName(deviceArch)}): install the $deviceArch build of the model"
    }

    private fun chipName(arch: String): String = CHIPS.firstOrNull { it.arch == arch }?.name ?: "another Snapdragon"
}
