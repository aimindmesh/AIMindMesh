package com.aimindmesh.whisper;

import android.content.Context;
import android.os.Build;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.InputStreamReader;

/**
 * Device-specific optimization helper for Whisper.
 * Detects SoC type and provides optimal configuration recommendations.
 * 
 * Supported devices:
 * - Galaxy Z Fold 7: Snapdragon 8 Elite (SM8750, Oryon V2 cores)
 * - Galaxy Z Fold 5: Snapdragon 8 Gen 2 (SM8550, Cortex-X3 cores)
 * - Generic ARM devices: Fallback configuration
 */
public class WhisperDeviceOptimizer {
    private static final String TAG = "WhisperDeviceOptimizer";

    public enum SoC {
        SNAPDRAGON_8_ELITE, // Z Fold 7 - SM8750
        SNAPDRAGON_8_GEN_2, // Z Fold 5 - SM8550
        UNKNOWN
    }

    private final Context context;
    private SoC cachedSoC = null;

    public WhisperDeviceOptimizer(Context context) {
        this.context = context.getApplicationContext();
    }

    /**
     * Detect the SoC type of the current device.
     * Results are cached after first detection.
     */
    public SoC detectSoC() {
        if (cachedSoC != null) {
            return cachedSoC;
        }

        String chipset = getChipsetName();
        Log.i(TAG, "Detected chipset: " + chipset);

        cachedSoC = matchSoC(chipset);
        Log.i(TAG, "Matched SoC: " + cachedSoC);

        return cachedSoC;
    }

    private SoC matchSoC(String chipset) {
        if (chipset == null || chipset.isEmpty()) {
            return SoC.UNKNOWN;
        }

        String lower = chipset.toLowerCase();

        // Z Fold 7: Snapdragon 8 Elite (Oryon V2)
        if (lower.contains("sm8750") ||
                lower.contains("oryon") ||
                lower.contains("8 elite") ||
                lower.contains("8elite")) {
            return SoC.SNAPDRAGON_8_ELITE;
        }

        // Z Fold 5: Snapdragon 8 Gen 2 (Cortex-X3)
        if (lower.contains("sm8550") ||
                lower.contains("8 gen 2") ||
                lower.contains("8gen2") ||
                lower.contains("cortex-x3")) {
            return SoC.SNAPDRAGON_8_GEN_2;
        }

        return SoC.UNKNOWN;
    }

    /**
     * Get chipset name using multiple detection methods.
     */
    private String getChipsetName() {
        StringBuilder result = new StringBuilder();

        // Method 1: Build.SOC_MODEL (Android 12+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            String socModel = Build.SOC_MODEL;
            if (socModel != null && !socModel.isEmpty() && !socModel.equals("unknown")) {
                result.append(socModel).append(" ");
            }
        }

        // Method 2: Build.HARDWARE
        String hardware = Build.HARDWARE;
        if (hardware != null && !hardware.isEmpty()) {
            result.append(hardware).append(" ");
        }

        // Method 3: Build.BOARD
        String board = Build.BOARD;
        if (board != null && !board.isEmpty()) {
            result.append(board).append(" ");
        }

        // Method 4: System properties via getprop
        String propChip = getSystemProperty("ro.chipname");
        if (propChip != null && !propChip.isEmpty()) {
            result.append(propChip).append(" ");
        }

        String propSoc = getSystemProperty("ro.hardware.chipname");
        if (propSoc != null && !propSoc.isEmpty()) {
            result.append(propSoc).append(" ");
        }

        // Method 5: /proc/cpuinfo
        String cpuInfoChip = getChipsetFromCpuInfo();
        if (cpuInfoChip != null && !cpuInfoChip.isEmpty()) {
            result.append(cpuInfoChip);
        }

        return result.toString().trim();
    }

    private String getSystemProperty(String propName) {
        try {
            Process process = Runtime.getRuntime().exec("getprop " + propName);
            BufferedReader reader = new BufferedReader(
                    new InputStreamReader(process.getInputStream()));
            String line = reader.readLine();
            reader.close();
            return line != null ? line.trim() : "";
        } catch (Exception e) {
            Log.w(TAG, "Failed to get property " + propName, e);
            return "";
        }
    }

    private String getChipsetFromCpuInfo() {
        try {
            File cpuInfo = new File("/proc/cpuinfo");
            if (!cpuInfo.exists())
                return "";

            BufferedReader reader = new BufferedReader(new FileReader(cpuInfo));
            String line;
            while ((line = reader.readLine()) != null) {
                String lower = line.toLowerCase();
                // Look for specific SoC identifiers
                if (lower.contains("sm8750")) {
                    reader.close();
                    return "SM8750";
                }
                if (lower.contains("sm8550")) {
                    reader.close();
                    return "SM8550";
                }
                // Hardware line
                if (lower.startsWith("hardware")) {
                    String[] parts = line.split(":");
                    if (parts.length > 1) {
                        reader.close();
                        return parts[1].trim();
                    }
                }
            }
            reader.close();
        } catch (Exception e) {
            Log.w(TAG, "Failed to read /proc/cpuinfo", e);
        }
        return "";
    }

    /**
     * Get the number of available CPU cores.
     */
    public int getCoreCount() {
        return Runtime.getRuntime().availableProcessors();
    }

    /**
     * Get recommended thread count for the detected SoC.
     * This is a suggestion - the actual thread count can be user-configured.
     */
    public int getRecommendedThreadCount(SoC soc) {
        switch (soc) {
            case SNAPDRAGON_8_ELITE:
                // Z Fold 7: 2x Phoenix-L + 6x Phoenix-M = 8 cores
                // All cores are efficient, use all 8
                return 8;

            case SNAPDRAGON_8_GEN_2:
                // Z Fold 5: 1x Cortex-X3 + 2x Cortex-A715 + 2x Cortex-A710 + 3x Cortex-A510
                // Use 6 threads to avoid thermal throttling on big cores
                return 6;

            case UNKNOWN:
            default:
                // Fallback: use 70% of available cores, minimum 4
                int cores = getCoreCount();
                return Math.max(4, (int) (cores * 0.7));
        }
    }

    /**
     * Get recommended Whisper model based on SoC capability.
     */
    public String getRecommendedModel(SoC soc) {
        switch (soc) {
            case SNAPDRAGON_8_ELITE:
                // Z Fold 7: More powerful, can handle larger quantized model
                return "ggml-base-q8_0";

            case SNAPDRAGON_8_GEN_2:
                // Z Fold 5: Use slightly smaller quantization
                return "ggml-base-q5_1";

            case UNKNOWN:
            default:
                // Conservative fallback for generic devices
                return "ggml-tiny-q5_1";
        }
    }

    /**
     * Get full device optimization info as a formatted string for logging.
     */
    public String getDeviceInfoString() {
        SoC soc = detectSoC();
        return String.format(
                "===== WHISPER DEVICE OPTIMIZATION =====\n" +
                        "Detected SoC: %s\n" +
                        "Available Cores: %d\n" +
                        "Recommended Threads: %d\n" +
                        "Recommended Model: %s\n" +
                        "Build Model: %s\n" +
                        "Device: %s\n" +
                        "Android Version: %d\n" +
                        "========================================",
                soc.name(),
                getCoreCount(),
                getRecommendedThreadCount(soc),
                getRecommendedModel(soc),
                Build.MODEL,
                Build.DEVICE,
                Build.VERSION.SDK_INT);
    }
}
