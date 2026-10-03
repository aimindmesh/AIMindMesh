package com.aimindmesh.llama;

import android.os.Build;
import android.util.Log;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.IOException;

/**
 * Picks the llama.cpp native library built for the features of this CPU (see the
 * variants in CMakeLists.txt) and loads it once for the whole process.
 *
 * The universal library is compiled for the baseline ISA (armv8-a): it is only the
 * fallback, so a CPU without dotprod/fp16 never meets an instruction it cannot run.
 */
final class NativeLibrarySelector {
    private static final String TAG = "NativeLibrarySelector";
    /** Universal build, OUTPUT_NAME "llama-cpp-arm64" for every ABI */
    static final String UNIVERSAL = "llama-cpp-arm64";

    private static String loaded;

    private NativeLibrarySelector() {}

    static synchronized void load() {
        if (loaded != null) return;
        String best = best();
        try {
            System.loadLibrary(best);
            loaded = best;
        } catch (UnsatisfiedLinkError e) {
            if (best.equals(UNIVERSAL)) throw e;
            Log.w(TAG, "lib" + best + ".so not loadable, using the universal library", e);
            System.loadLibrary(UNIVERSAL);
            loaded = UNIVERSAL;
        }
        Log.i(TAG, "Loaded native library: lib" + loaded + ".so");
    }

    static String best() {
        String cpuFeatures = getCPUFeatures();
        boolean hasFp16 = cpuFeatures.contains("fp16") || cpuFeatures.contains("fphp");
        boolean hasDotProd = cpuFeatures.contains("dotprod") || cpuFeatures.contains("asimddp");
        boolean hasSve = cpuFeatures.contains("sve");
        boolean hasI8mm = cpuFeatures.contains("i8mm");
        boolean isAtLeastArmV82 = cpuFeatures.contains("asimd") &&
                cpuFeatures.contains("crc32") &&
                cpuFeatures.contains("aes");
        boolean isAtLeastArmV84 = cpuFeatures.contains("dcpop") && cpuFeatures.contains("uscat");
        boolean isEmulated = Build.HARDWARE.contains("goldfish") || Build.HARDWARE.contains("ranchu");
        Log.d(TAG, "CPU features: " + cpuFeatures + " (emulated: " + isEmulated + ")");

        if (!isEmulated && Build.SUPPORTED_ABIS.length > 0 && "arm64-v8a".equals(Build.SUPPORTED_ABIS[0])) {
            if (isAtLeastArmV84 && hasSve && hasI8mm && hasFp16 && hasDotProd) return "llama_cpp_v8_4_fp16_dotprod_i8mm_sve";
            if (isAtLeastArmV84 && hasSve && hasFp16 && hasDotProd) return "llama_cpp_v8_4_fp16_dotprod_sve";
            if (isAtLeastArmV84 && hasI8mm && hasFp16 && hasDotProd) return "llama_cpp_v8_4_fp16_dotprod_i8mm";
            if (isAtLeastArmV84 && hasFp16 && hasDotProd) return "llama_cpp_v8_4_fp16_dotprod";
            if (isAtLeastArmV82 && hasFp16 && hasDotProd) return "llama_cpp_v8_2_fp16_dotprod";
            if (isAtLeastArmV82 && hasFp16) return "llama_cpp_v8_2_fp16";
            return "llama_cpp_v8";
        }
        if (!isEmulated && Build.SUPPORTED_32_BIT_ABIS.length > 0 &&
                "armeabi-v7a".equals(Build.SUPPORTED_32_BIT_ABIS[0])) {
            return "llama_cpp_v7a";
        }
        return UNIVERSAL;
    }

    /** "Features" line of /proc/cpuinfo, lower case ("" if unreadable). */
    private static String getCPUFeatures() {
        File cpuInfoFile = new File("/proc/cpuinfo");
        if (!cpuInfoFile.exists()) return "";
        try (BufferedReader reader = new BufferedReader(new FileReader(cpuInfoFile))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.toLowerCase().startsWith("features")) {
                    int colonIndex = line.indexOf(':');
                    if (colonIndex > 0) return line.substring(colonIndex + 1).trim().toLowerCase();
                }
            }
        } catch (IOException e) {
            Log.e(TAG, "Failed to read CPU features: " + e.getMessage());
        }
        return "";
    }
}
