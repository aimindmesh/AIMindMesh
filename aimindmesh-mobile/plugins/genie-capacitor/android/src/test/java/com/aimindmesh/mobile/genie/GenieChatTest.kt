package com.aimindmesh.mobile.genie

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.util.Base64

class GenieChatTest {
    private val png = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47)
    private val b64 = Base64.getEncoder().encodeToString(png)

    @Test
    fun decodesDataUrlsAndPlainBase64() {
        val (bytes, ext) = GenieChat.decodeImage("data:image/png;base64,$b64")!!
        assertArrayEquals(png, bytes)
        assertEquals("png", ext)
        assertEquals("jpg", GenieChat.decodeImage(b64)!!.second)
        assertNull(GenieChat.decodeImage("data:image/png;base64,%%%"))
        assertNull(GenieChat.decodeImage(""))
    }

    @Test
    fun writesTheImagesOfThisPromptOnly() {
        val dir = Files.createTempDirectory("genie-images").toFile()
        File(dir, "old.jpg").writeText("stale")
        val paths = GenieChat.writeImages(dir, listOf("data:image/png;base64,$b64", "not base64 %%", b64))
        assertEquals(listOf("image_0.png", "image_2.jpg"), paths.map { File(it).name })
        assertEquals(setOf("image_0.png", "image_2.jpg"), dir.list()!!.toSet())
        dir.deleteRecursively()
    }

    @Test
    fun mapsToolCallsAndToolResultsToGenieXMessages() {
        val turns = listOf(
            GenieTurn("user", "Che tempo fa?"),
            GenieTurn("assistant", "", toolCalls = listOf(GenieToolCall("c1", "search_web", "{\"query\":\"meteo\"}"))),
            GenieTurn("tool", "Sole", toolCallId = "c1", toolName = "search_web")
        )
        val messages = GenieChat.toChatMessages(turns)
        assertEquals(0, messages[0].toolCalls.size)
        assertEquals("search_web", messages[1].toolCalls[0].name)
        assertEquals("{\"query\":\"meteo\"}", messages[1].toolCalls[0].arguments)
        assertEquals("c1", messages[2].toolCallId)
        assertEquals("search_web", messages[2].toolName)
        assertEquals("tool", GenieChat.toVlmMessages(turns)[2].role)
    }
}
