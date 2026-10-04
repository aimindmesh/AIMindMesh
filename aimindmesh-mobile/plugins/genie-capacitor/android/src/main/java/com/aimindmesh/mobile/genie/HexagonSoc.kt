package com.aimindmesh.mobile.genie

/** Hexagon NPU generation of a Snapdragon, from Build.SOC_MODEL / BOARD / HARDWARE (pure, unit tested) */
object HexagonSoc {
    private val KNOWN = listOf(
        Triple("sm8850", "canoe", "v81"),     // Snapdragon 8 Elite Gen 5
        Triple("sm8750", "sun", "v79"),       // Snapdragon 8 Elite (Fold7)
        Triple("sm8650", "pineapple", "v75"), // Snapdragon 8 Gen 3
        Triple("sm8550", "kalama", "v73"),    // Snapdragon 8 Gen 2 (Fold5)
        Triple("sm8475", "cape", "v69"),
        Triple("sm8450", "taro", "v69"),
    )

    fun arch(soc: String, board: String, hardware: String): String {
        val s = soc.lowercase()
        val b = board.lowercase()
        val h = hardware.lowercase()
        KNOWN.firstOrNull { (model, codename, _) -> s.contains(model) || h.contains(model) || b == codename }
            ?.let { return it.third }
        // Other Snapdragons: the oldest generation GenieX's llama_cpp NPU backend ships kernels for
        return if (h.contains("qcom") || s.startsWith("sm")) "v73" else "none"
    }

    /** QAIRT bundles: GenieX 0.3.5 ships the QNN HTP libraries for these generations only */
    fun qairtSupported(arch: String): Boolean = arch == "v79" || arch == "v81"
}
