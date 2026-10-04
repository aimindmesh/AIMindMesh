package com.aimindmesh.mobile.genie

import android.util.Log
import com.geniex.sdk.LlmWrapper
import com.geniex.sdk.VlmWrapper
import com.geniex.sdk.bean.ChatMessage
import com.geniex.sdk.bean.ToolCall
import com.geniex.sdk.bean.VlmChatMessage
import com.geniex.sdk.bean.VlmContent
import java.io.File
import java.util.Base64

/** A tool call of an assistant turn: `arguments` is a JSON object as text */
data class GenieToolCall(val id: String, val name: String, val arguments: String)

/**
 * A chat turn for the model's own template; `imageCount` images go before its text (vision
 * models). Assistant turns may carry tool calls; `tool` turns carry a result for `toolCallId`.
 */
data class GenieTurn(
    val role: String,
    val content: String,
    val imageCount: Int = 0,
    val toolCalls: List<GenieToolCall> = emptyList(),
    val toolCallId: String? = null,
    val toolName: String? = null
)

/**
 * Prompts from the model's own chat template (GGUF metadata, QAIRT bundle tokenizer config), and
 * the image files of a vision prompt. A vision template gets one image slot per attached image
 * (Gemma 4: `<|image|>`), filled at generation with the files in the same order.
 */
object GenieChat {
    private const val TAG = "GenieChat"

    /**
     * Prompt for `turns`; `toolsJson` (a JSON array of OpenAI-style declarations) puts the tools
     * in the template's own format (Gemma 4 `<|tool>declaration:…`, Qwen `<tools>`).
     */
    suspend fun format(llm: LlmWrapper?, vlm: VlmWrapper?, turns: List<GenieTurn>, enableThinking: Boolean, toolsJson: String? = null): String? {
        val tools = toolsJson?.takeIf { it.isNotBlank() }
        if (vlm != null) {
            return vlm.applyChatTemplate(toVlmMessages(turns), tools, enableThinking)
                .getOrElse { Log.w(TAG, "Vision chat template failed: ${it.message}"); null }?.formattedText
        }
        val wrapper = llm ?: return null
        return wrapper.applyChatTemplate(
            messages = toChatMessages(turns),
            tools = tools,
            enableThinking = enableThinking,
            addGenerationPrompt = true
        ).getOrElse { Log.w(TAG, "Chat template failed: ${it.message}"); null }?.formattedText
    }

    private fun callsOf(turn: GenieTurn): List<ToolCall> = turn.toolCalls.map { ToolCall(it.id, it.name, it.arguments) }

    /** Turns as GenieX messages, tool calls and tool results included (pure, unit tested) */
    fun toChatMessages(turns: List<GenieTurn>): Array<ChatMessage> =
        turns.map { ChatMessage(it.role, it.content, callsOf(it), it.toolCallId, it.toolName) }.toTypedArray()

    fun toVlmMessages(turns: List<GenieTurn>): Array<VlmChatMessage> =
        turns.map { turn ->
            val parts = List(turn.imageCount) { i -> VlmContent(type = "image", text = "image_$i") } +
                VlmContent(type = "text", text = turn.content)
            VlmChatMessage(turn.role, parts, callsOf(turn), turn.toolCallId, turn.toolName)
        }.toTypedArray()

    /** Bytes and file extension of a data URL or plain base64 image (pure, unit tested) */
    fun decodeImage(data: String): Pair<ByteArray, String>? {
        val comma = data.indexOf("base64,")
        val payload = if (comma >= 0) data.substring(comma + 7) else data
        val mime = if (data.startsWith("data:")) data.substringAfter("data:").substringBefore(';') else "image/jpeg"
        val ext = when (mime.lowercase()) { "image/png" -> "png"; "image/webp" -> "webp"; else -> "jpg" }
        return try {
            Base64.getMimeDecoder().decode(payload.trim()).takeIf { it.isNotEmpty() }?.let { it to ext }
        } catch (e: IllegalArgumentException) {
            null
        }
    }

    /** Writes the images of this prompt to `dir` (replacing the previous ones) and returns their paths, in order */
    fun writeImages(dir: File, images: List<String>): List<String> {
        dir.mkdirs()
        dir.listFiles()?.forEach { it.delete() }
        return images.mapIndexedNotNull { i, data ->
            val (bytes, ext) = decodeImage(data) ?: return@mapIndexedNotNull null
            File(dir, "image_$i.$ext").apply { writeBytes(bytes) }.absolutePath
        }
    }
}
