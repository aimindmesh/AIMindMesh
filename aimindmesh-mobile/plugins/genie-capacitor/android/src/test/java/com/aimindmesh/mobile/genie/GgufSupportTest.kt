package com.aimindmesh.mobile.genie

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class GgufSupportTest {
    @Test
    fun readsTheWeightFormatFromRealFileNames() {
        assertEquals("Q4_0", GgufSupport.weightFormat("Qwen3.5-4B-Q4_0.gguf"))
        assertEquals("Q4_0", GgufSupport.weightFormat("gemma-4-E2B_q4_0-it.gguf"))
        assertEquals("IQ4_NL", GgufSupport.weightFormat("Qwen3.5-2B-IQ4_NL.gguf"))
        assertEquals("Q4_K_M", GgufSupport.weightFormat("qwen2.5-vl-7b-instruct-q4_k_m.gguf"))
        assertNull(GgufSupport.weightFormat("model.gguf"))
    }

    @Test
    fun onlyFormatsWithHexagonKernelsAreNpuReady() {
        assertTrue(GgufSupport.npuReady("Qwen3.5-4B-Q4_0.gguf"))
        assertTrue(GgufSupport.npuReady("Qwen3.5-4B-Q8_0.gguf"))
        assertFalse(GgufSupport.npuReady("gemma-2-2b-it-Q4_K_M.gguf"))
        assertFalse(GgufSupport.npuReady("model-F16.gguf"))
    }

    @Test
    fun autoTriesTheNpuThenTheGpuThenTheCpu() {
        assertEquals(listOf("npu", "gpu", "cpu"), GgufSupport.unitsFor("auto"))
        assertEquals(listOf("npu", "gpu", "cpu"), GgufSupport.unitsFor(null))
        assertEquals(listOf("gpu"), GgufSupport.unitsFor("GPU"))
        assertEquals(0, GgufSupport.gpuLayersFor("cpu"))
        assertEquals(listOf("gpu", "cpu"), GgufSupport.unitsFor("auto", npuReady = false))
        assertEquals(listOf("npu"), GgufSupport.unitsFor("npu", npuReady = false))
        assertTrue(GgufSupport.unitSatisfies("auto", "gpu"))
        assertTrue(GgufSupport.unitSatisfies("npu", "npu"))
        assertFalse(GgufSupport.unitSatisfies("npu", "gpu"))
        assertFalse(GgufSupport.unitSatisfies("auto", null))
        assertEquals(4096, GgufSupport.contextFor(0))
        assertEquals(8192, GgufSupport.contextFor(8192))
    }

    @Test
    fun findsDownloadedModelsByNameOrPath() {
        val dir = Files.createTempDirectory("gguf").toFile()
        val model = File(dir, "Qwen3.5-2B-Q4_0.gguf").apply { writeText("x") }
        assertEquals(model, GgufSupport.resolve(dir, "Qwen3.5-2B-Q4_0.gguf"))
        assertEquals(model, GgufSupport.resolve(dir, model.absolutePath))
        assertNull(GgufSupport.resolve(dir, "missing.gguf"))
        assertNull(GgufSupport.resolve(dir, "bundle.zip"))
        dir.deleteRecursively()
    }

    @Test
    fun resetsTheGenieXCacheUnlessThePromptContinuesTheLastOne() {
        val turn1 = "<|turn>system\nS<turn|>\n<|turn>user\nCiao<turn|>\n<|turn>model\n"
        val turn2 = turn1 + "Ciao!<turn|>\n<|turn>user\nCome va?<turn|>\n<|turn>model\n"
        assertFalse(GgufSupport.mustResetBefore(null, dirty = false, prompt = turn1))       // fresh load
        assertFalse(GgufSupport.mustResetBefore(turn1, dirty = false, prompt = turn2))      // next chat turn
        assertTrue(GgufSupport.mustResetBefore(turn2, dirty = false, prompt = "<|turn>system\nExtract facts")) // background task
        assertTrue(GgufSupport.mustResetBefore(turn1, dirty = true, prompt = turn2))        // last one failed or was stopped
        assertTrue(GgufSupport.isContextOverflow("LLM generate failed: Context length exceeded"))
        assertFalse(GgufSupport.isContextOverflow("Model loading failed"))
    }
}
