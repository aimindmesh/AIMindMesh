package com.aimindmesh.mobile.sd

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Expected ids come from an independent port of OpenAI's CLIP simple_tokenizer on the same vocabulary. */
class ClipTokenizerTest {
    private val tokenizer = File("src/main/assets/sd_tokenizer").let { dir ->
        File(dir, "vocab.json").inputStream().use { v ->
            File(dir, "merges.txt").inputStream().use { m -> ClipTokenizer.fromStreams(v, m) }
        }
    }

    private fun ids(prompt: String) = tokenizer.encode(prompt).let { t ->
        t.copyOfRange(1, t.indexOf(ClipTokenizer.END_TOKEN_ID))
    }

    @Test
    fun matchesTheReferenceTokenizer() {
        assertArrayEquals(intArrayOf(320, 1125, 539, 320, 2368), ids("a photo of a cat"))
        assertArrayEquals(intArrayOf(1153, 16157, 5352, 267, 279, 330, 84, 4414, 267, 33740), ids("Photorealistic portrait,  8k UHD, DSLR"))
        assertArrayEquals(intArrayOf(550, 18376, 6765, 320, 4558, 525, 7496), ids("an astronaut riding a horse on mars"))
    }

    @Test
    fun padsLikeTheModelTokenizer() {
        val sd2 = tokenizer.encode("red car")
        assertArrayEquals(intArrayOf(ClipTokenizer.START_TOKEN_ID, 736, 1615, ClipTokenizer.END_TOKEN_ID, 0), sd2.copyOfRange(0, 5))
        assertEquals(77, sd2.size)
        val sd1 = tokenizer.encode("red car", ClipTokenizer.END_TOKEN_ID)
        assertTrue(sd1.copyOfRange(3, 77).all { it == ClipTokenizer.END_TOKEN_ID })
        val empty = tokenizer.encode("")
        assertArrayEquals(intArrayOf(ClipTokenizer.START_TOKEN_ID, ClipTokenizer.END_TOKEN_ID, 0), empty.copyOfRange(0, 3))
    }

    @Test
    fun readsPromptWeights() {
        val t = tokenizer.encodeWithWeights("a (red:1.5) car, [blurry], (sharp)")
        // a | red | car | , | blurry | , | sharp
        assertArrayEquals(intArrayOf(320, 736, 1615), t.tokens.copyOfRange(1, 4))
        assertEquals(1.0f, t.weights[1], 0f)
        assertEquals(1.5f, t.weights[2], 0f)
        assertEquals(1.0f, t.weights[3], 0f)
        val blurry = t.tokens.indexOfFirst { it == ids("blurry").single() }
        assertEquals(1 / 1.1f, t.weights[blurry], 1e-6f)
        val sharp = t.tokens.indexOfFirst { it == ids("sharp").single() }
        assertEquals(1.1f, t.weights[sharp], 1e-6f)
    }

    @Test
    fun reportsTruncatedPrompts() {
        assertFalse(tokenizer.encodeWithWeights("a photo of a cat").truncated)
        val long = tokenizer.encodeWithWeights(List(80) { "cat" }.joinToString(" "))
        assertTrue(long.truncated)
        assertEquals(ClipTokenizer.END_TOKEN_ID, long.tokens[76])
        val exact = tokenizer.encodeWithWeights(List(75) { "cat" }.joinToString(" "))
        assertFalse(exact.truncated)
    }
}
